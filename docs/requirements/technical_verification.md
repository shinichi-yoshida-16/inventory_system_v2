# 技術検証

要件定義 6.2 / 9章「開発フロー」2. 技術検証。以下4点について、実装方式を確定するための検証を行った。検証項目と要件のトレース対応表は [requestment.md 6.2](requestment.md#62-技術検証結果を受けた全体構成方針) を参照（本書の「検証1」〜「検証4」が同表の #1〜#4 に対応）。

## 0. 検証環境・前提

| 項目 | 内容 |
|---|---|
| 実施日 | 2026-09-08 |
| 検証コード | `verification/` 配下（プロジェクトルート直下。`.gitignore` により **git 管理対象外**。2026-09-11 に `~/verification` から移設） |
| ランタイム | Node.js v24、`googleapis` / `@google-cloud/storage` / `@zxing/library` / `bwip-js` |
| 使用した認証情報 | `src/.env` のサービスアカウント `inventory-system-dev@inventory-system-507404.iam.gserviceaccount.com`（スコープはスプレッドシート共有のみ）|
| 対象スプレッドシート | `gulliver_database`（`InventoryMaster` / `TransactionLog` / `NotificationTargets` / `AllowList`）|

> 検証は「新アーキテクチャ = Nuxt4（TypeScript）を Google Cloud（Cloud Run 想定）にデプロイし、`googleapis` から Google スプレッドシートを DB として操作する」構成を前提とする。旧構成（Google Apps Script + `LockService`）の前提は用いない。

## 検証結果サマリ

| # | 検証項目 | 結論 | 実装方式 |
|---|---|---|---|
| 1 | GCP 上に更新失敗時の一時データ（蓄積データ）を保持できるか | **可能**（ただし環境準備が必要） | GCS バケットに JSON オブジェクトとして保存。Cloud Run → GCS は標準構成 |
| 2 | Google スプレッドシートで排他ロックを取得できるか | スプレッドシート単体では**不可**。外部の排他機構が**必須** | GCS オブジェクトの `ifGenerationMatch=0` による原子的ロック（+ Cloud Run `max-instances=1` の多重防御）|
| 3 | GCP で Gmail の送信数制限はあるか | **ある**（無料 Gmail 500 通/日、Workspace 2,000 通/日。引き上げ不可）| 業務規模では上限に十分収まる。**認証方式の準備が課題**（SAだけでは送信不可）|
| 4 | JS によるカメラ起動 / バーコード読み取りは可能か | **可能**（HTTPS 必須、通常ブラウザ限定）| `getUserMedia` + ZXing-js。QR / JAN / GS1 DataMatrix のデコードと GTIN 抽出を実証済み |

---

## 検証1. GCP 上に更新失敗時の一時データ（蓄積データ）を保持できるか

要件 FR-14 / FR-15：DB 更新に失敗した入出庫データを、後追いの「時差更新」用にサーバ側へ時系列で保持する。要件では「Google Storage バケット上で JSON ファイルとして保持」とされている。

### 検証方法
- `verification/01_gcs_bucket.mjs` … サービスアカウントで実際にバケット作成・JSON オブジェクトの書き込み/読み出し/削除を試行
- `verification/01b_gcs_api_surface.mjs` … Cloud Storage JSON API のディスカバリドキュメントを取得し、排他制御に使える条件付き操作パラメータの有無を確認

### 結果
- **実書き込み検証は実施できなかった。** 共有されているサービスアカウントはスプレッドシート用途に限定されており、`storage.buckets.list` / `storage.buckets.create` が権限拒否。対象プロジェクト `inventory-system-507404` に既存バケットも存在しない。
- API 仕様上、`objects.insert` は以下の前提条件パラメータを持つことを確認した。
  - `ifGenerationMatch` … 「`0` を指定するとオブジェクトが存在しない場合のみ成功」＝**原子的な create-if-absent**
  - `ifGenerationNotMatch` / `ifMetagenerationMatch` / `ifMetagenerationNotMatch`
  - `objects.patch` / `objects.delete` にも `generation` / `ifGenerationMatch` あり

### 結論
- GCS への一時データ保持は **一般的な Cloud Storage の機能であり、技術的に問題なく実現できる**（Cloud Run のサーバコードから `@google-cloud/storage` で読み書きするのは定石構成）。無料枠（リージョナル 5GB・月、少量の操作）に十分収まる。
- 蓄積データのオブジェクト設計（案）：
  - `pending/{ISO8601タイムスタンプ}-{ランダム}.json` に1操作1オブジェクト（時系列は名前順で担保）
  - 中身：`{ itemId, type: "IN"|"OUT", quantity, operator, occurredAt }`
  - 時差更新時に `pending/` をプレフィックス一覧 → 名前順に適用 → 成功分を削除。全件成功でユーザに完了通知、失敗が残れば再実施を促す（FR-15）

### 実装前の TODO
1. 一時データ / ロック用の GCS バケットを1つ作成（ロケーションは `asia-northeast1`）
2. Cloud Run 実行サービスアカウントに、そのバケットへの `roles/storage.objectAdmin` を付与
3. 上記付与後、`01_gcs_bucket.mjs` を再実行して実書き込み・オブジェクトロックの往復を確認する

> 具体的な作成コマンド・IAM 付与手順は [deployment.md](../manuals/deployment.md) 3.3、疎通確認は同 6章に集約。

---

## 検証2. Google スプレッドシートで排他ロックを取得できるか

要件 FR-14：入庫/出庫の DB 更新タイミングが重なった場合、先の更新が終わるまで次を待機させる。排他ロックが取得できなければ待機、待ち時間が長ければ時差更新に切り替える（待ち時間 5〜10 秒）。

### 検証方法（すべて実行済み・実スプレッドシートに対して実施）
- `verification/02_sheets_lock.mjs`
  - **A**: Sheets API v4 ディスカバリドキュメントを解析し、条件付き書き込み（ETag / precondition）パラメータの有無を確認
  - **B**: ロックなしで「セルを読む → 少し待つ → +1 して書く」を並行実行し、lost update が発生するか計測
  - **C**: 「ロックセルが空のときだけ owner を書き、書き込み後に読み直して自分が勝ったか確認する」擬似ミューテックスを並行試行
- `verification/02c_toctou.mjs` … 「空を確認してから書く」だけの素朴なセルロックを3並行で実行し、クリティカルセクションへの同時侵入を計測

### 結果
| 検証 | 結果 |
|---|---|
| A. 条件付き書き込み | `spreadsheets.values.update` / `batchUpdate` / `append` のいずれにも `ifMatch` / `etag` / `precondition` 系パラメータは **存在しない**。ディスカバリドキュメント全体にも `etag` の語がない。→ **楽観ロックの土台が API に無い** |
| B. lost update | 初期値 0 に対し **10 並行**インクリメント → 最終値 **1**（lost update 9 件）。**20 並行**では最終値 1（lost update 19 件）。→ ロックなしでは在庫数が容易に壊れる |
| C. セルロック（確認読みあり） | ある試行では二重侵入 0 回だったが、確認読みと処理開始の間に他者が上書きし得るため **保証されない**（試行タイミング依存）|
| C'. セルロック（確認読みなし・素朴版） | 3 ワーカーが同時に「空」を観測 → **3 人全員がクリティカルセクションに侵入**（重なり 2 回）。→ 「空を確認してから書く」だけでは排他が成立しない |
| 補足: レートリミット | 検証中に `RESOURCE_EXHAUSTED`（`Read requests per minute per user` = **60/分**）に到達。ポーリング型ロックはこのクォータを急速に消費する |

- 参考（公式仕様）：Sheets API v4 は 読み取り/書き込みとも **60 req/分/ユーザ・300 req/分/プロジェクト**。単一 `batchUpdate` は原子的に適用されるが、これは「1リクエスト内」の話で、read→write をまたぐ更新の競合は防げない。ドキュメントレベルのロック機構は提供されない。
- 旧構成で使っていた Apps Script の `LockService` は **Apps Script ランタイム専用**であり、Cloud Run 上の Nuxt からは利用できない。

### 結論
**Google スプレッドシート単体では排他ロックを取得できない。** DB の外に排他機構を持つ必要がある。採用方針は以下。

1. **主機構: GCS オブジェクトロック（検証1のバケットを流用）**
   - 取得：`objects.insert(name="locks/inventory.lock", ifGenerationMatch=0, body={owner, acquiredAt})` が成功したらロック取得。412（Precondition Failed）なら他者が保持中。
   - 解放：取得時の `generation` を条件に `objects.delete`。
   - スタックロック対策：ロック本文の `acquiredAt` を見て、一定時間（例 30 秒）超過なら `ifGenerationMatch=<現generation>` 付きで強制奪取。
   - 入出庫の DB 更新（在庫増減 → アラート要否判定 → 履歴追記）を、このロック内で一連に実行する。
   - タイムアウト（5〜10 秒）内に取得できなければ、検証1の蓄積データを書いてユーザに即応答（時差更新へ）。
2. **多重防御: Cloud Run `max-instances=1` + インスタンス内キュー**
   - 利用者は最大 10 名（NR-01）で、書き込みは 60 req/分/ユーザに収まる規模。単一インスタンスに集約し、インスタンス内で更新処理を直列化すれば、GCS ロックはインスタンス再起動やコールドスタート跨ぎの保険として機能する。
3. 管理者のスプレッドシート直接編集は排他対象外（要件10章の通り運用でカバー）。

> Firestore（ネイティブトランザクションで真の排他が可能）への切り替えも選択肢だが、要件の「DB は Google スプレッドシートを軸」「Google 無料枠」を尊重し、まずは上記構成とする。ロック層のみ将来 Firestore に寄せる余地は残す。

---

## 検証3. GCP で Gmail の送信数制限はあるか

要件 FR-09：在庫が閾値を下回ったら通知先設定の全アドレスへ自動送信。Gmail 送信数上限に達したら当日はストップし、翌日以降にマージして通知。

### 検証方法
- 公式ドキュメント（Gmail API Usage limits / Workspace 送信上限）の確認。
- 実送信の検証は **実施できなかった**（サービスアカウント単体では Gmail を送信できず、OAuth ユーザ資格情報 or Workspace のドメイン全体委任が必要なため）。

### 結果（制限は「ある」）
| 区分 | 制限 |
|---|---|
| 無料 Gmail アカウント | **500 通/日**（宛先数ベース。To/Cc/Bcc の各アドレスを1カウント）。引き上げ不可 |
| Google Workspace アカウント | **2,000 通/日 / 宛先 10,000/日**。引き上げ不可 |
| Gmail API: 1メッセージあたり宛先 | **500 宛先/メッセージ** |
| Gmail API: レート | 6,000 quota units/分/ユーザ、1,200,000/分/プロジェクト（`messages.send` = 100 units → 実質 約 60 通/分/ユーザ）|
| 課金しきい値（2026-05-01〜） | 80,000,000 quota units/日/プロジェクト 未満は無料 |
| 超過時の挙動 | HTTP 429 / `RESOURCE_EXHAUSTED`。指数バックオフ推奨 |

### 結論
- **業務規模では送信数上限は問題にならない。** 整備士 10 名・品目数も限定的で、閾値割れ通知は1日あたり多くて数件。無料 Gmail の 500 通/日でも十分。
- **本当の論点は送信の認証方式。** Cloud Run 上のコードから Gmail を送るには次のいずれかが必要：
  1. 通知専用の Gmail アカウントを用意し、その **OAuth2 リフレッシュトークン**を Secret Manager に格納して `googleapis` で送信（無料 Gmail 可・推奨）
  2. Google Workspace 契約 + サービスアカウントの**ドメイン全体委任**
  3. Gmail API を使わず **SMTP + アプリパスワード**（`nodemailer`）
  4. 外部メール送信サービスの無料枠（SendGrid / Resend 等）
- FR-09 の「上限到達で当日停止・翌日マージ」は、送信呼び出しの 429 / quota エラーを捕捉して実現可能。設計（overview.md 4.4 / 6.4）と整合する。アラート送信失敗が在庫更新自体を止めない設計にすること。

### 実装前の TODO
1. 通知方式を上記1〜4から決定（推奨: 1 の OAuth2 リフレッシュトークン方式）
2. 決定後、`verification` に実送信の1往復テストを追加して疎通確認（送信元・送信先・日次カウントの挙動）

> OAuth2 リフレッシュトークンの取得・Secret Manager への格納・実行SAへの参照権限付与の手順は [deployment.md](../manuals/deployment.md) 3.5、疎通確認は同 6章に集約。

---

## 検証4. JS によるカメラ起動 / バーコード読み取りは可能か

要件 FR-05 / D-03：スマホカメラで自社発行 QR またはメーカー添付バーコード（JAN / EAN-13、GS1 DataMatrix 等）を読み取り、品目 ID を特定する。

### 検証方法
- `verification/04_barcode_decode.mjs` … `qrcode` / `bwip-js` で各フォーマットの画像を生成し、`@zxing/library`（ZXing-js）でデコード。GTIN 正規化まで確認。
- `verification/04b_gs1_parser.mjs` … GS1 Application Identifier パーサ（AI 01 = GTIN 抽出、未対応 AI はエラーで弾く）の実装と境界ケース検証。
- カメラ（`getUserMedia`）自体はヘッドレス環境で検証不能のため、公式ドキュメントで制約を確認。

### 結果 — バーコードデコード（すべて実行・成功）
| フォーマット | 入力 | デコード結果 | 品目 ID の決定 |
|---|---|---|---|
| QR（自社発行）| `PART-000123` | `PART-000123` | 平文をそのまま使用 ✓ |
| JAN / EAN-13 | `4901234567894` | `4901234567894` | 先頭 `0` 付与 → GTIN-14 `04901234567894` ✓ |
| GS1 DataMatrix | `(01)04912345678904(17)261231(10)ABC123` | `\x1d01049123456789041726123110ABC123` | AI `01` を抽出 → GTIN `04912345678904` ✓ |

- GS1 パーサの境界ケース：固定長 AI（01=14桁, 17=6桁 等）と FNC1(`\x1d`)終端の可変長 AI を処理。**未対応 AI（例 8200, 99）に遭遇したら例外を投げ、誤った値を itemId として採用しない**ことを確認（要件10章「識別コード形式追加によるコード解析リスク」の対応方針と整合）。

### 結果 — カメラ（`getUserMedia`）
| 条件 | 可否 |
|---|---|
| セキュアコンテキスト（HTTPS / `localhost` / `file://`）| **必須**。HTTP では `navigator.mediaDevices` が `undefined` |
| Cloud Run / GitHub Pages 等のデプロイ先 | いずれも HTTPS 提供のため **問題なし** |
| デスクトップ Chrome/Firefox/Edge、Android Chrome、iOS Safari（11+）| **動作する** |
| サードパーティのアプリ内ブラウザ（LINE / Instagram / Facebook 等の WebView）| **不可 or 不安定**（iOS は特に WebRTC が Safari 本体のみ、in-app では音声制約付き getUserMedia が失敗する既知事象）|
| PWA スタンドアロンモード | 一部 iOS バージョンで不具合報告あり |
| Permissions-Policy / iframe | `camera` を許可する必要あり。iframe 埋め込み時は `allow="camera"` |

### 結論
- **JS でのカメラ起動・バーコード読み取りは実現可能。** ZXing-js は QR / JAN / GS1 DataMatrix をワンコードパスで扱え、要件の GTIN 正規化ロジックも実装できることを実証した。
- 運用制約：**「コードスキャン画面は必ず Safari / Chrome 等の通常ブラウザで開く」**をルール化する（取扱説明書に反映予定。overview.md 6.5 と整合）。アプリ内ブラウザ対策としてカメラを使わない手入力フォールバックの追加も検討余地（overview.md 7章 #8）。
- HTTPS は Cloud Run が自動提供するため追加対応不要。

### 実装前の TODO
1. 実機（iOS Safari / Android Chrome）での読み取り検証ページを `verification` に用意し、実際の JAN ラベル・GS1 DataMatrix ラベルで読み取り精度・GTIN 抽出を確認する
2. GF-04 の QR 印刷レイアウト（ラベル用紙サイズ、余白＝クワイエットゾーン）は実機印刷検証を待って確定

---

## 全体の実装前 TODO（再掲）

> これらの作業手順は [deployment.md](../manuals/deployment.md)（3章 インフラ構築 / 6章 デプロイ後の疎通確認）に集約した。本表は一覧のみ。

| # | 作業 | 担当/契機 | 手順 |
|---|---|---|---|
| 1 | 一時データ / ロック用 GCS バケット作成（`asia-northeast1`）| インフラ準備 | deployment.md 3.3 |
| 2 | Cloud Run 実行 SA にバケットの `roles/storage.objectAdmin` 付与 | インフラ準備 | deployment.md 3.2 / 3.3 |
| 3 | `01_gcs_bucket.mjs` 再実行 → GCS 書き込み・オブジェクトロックの実証 | 2 完了後 | deployment.md 6 |
| 4 | メール通知の認証方式決定（推奨: 通知専用 Gmail + OAuth2 リフレッシュトークン）→ 実送信疎通 | インフラ準備 | deployment.md 3.5 / 6 |
| 5 | 実機でのカメラ読み取り検証（iOS Safari / Android Chrome）| 実装フェーズ | deployment.md 6 |
