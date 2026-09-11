# デプロイ / インフラ構築手順

- 対象システム：整備部品在庫管理システムv2
- 本書の位置付け：Google Cloud 上のインフラ構成と、ビルド・デプロイ・初回セットアップ・疎通確認の**手順書**（要件定義 9章「開発フロー」6. インフラ準備／デプロイにあたる）。インフラの設計判断（`max-instances=1` の根拠、バケット設計、クォータ対策など）は [overview.md](../architecture/overview.md) 6章にあり、本書はその実行手順を示す
- 対応：[requestment.md](../requirements/requestment.md) 6章、[overview.md](../architecture/overview.md)（構成図 2章 / 非機能 6章 / 残課題 7章）、[technical_verification.md](../requirements/technical_verification.md)（検証1〜3 の「実装前 TODO」を本書に集約）

> **アーキテクチャ前提（[overview.md](../architecture/overview.md) と共通）**
> Nuxt4（TypeScript / Vue3）を単一アプリとして Cloud Run にデプロイし、`googleapis` で Google スプレッドシートを DB として操作する。旧 GAS 構成は用いない。

---

## 1. 構成要素

| 要素 | 用途 | 備考 |
|---|---|---|
| GCP プロジェクト | 全リソースの器 | `inventory-system-507404`（技術検証で使用） |
| Cloud Run サービス | Nuxt4 / Nitro アプリの実行 | リージョン `asia-northeast1`、`max-instances=1` |
| 実行サービスアカウント | Cloud Run にアタッチし Sheets / GCS / Secret Manager へアクセス | 検証用 SA とは別に、権限を絞って新規作成 |
| Cloud Storage バケット | 排他ロック（`locks/`）、時差更新（`pending/`）、通知マージ対象（`pending/alerts/`） | リージョン `asia-northeast1`。1バケットにプレフィックスで同居 |
| Secret Manager | 通知用 Gmail のアプリパスワード | `runtimeConfig` 経由でアプリへ注入 |
| Google スプレッドシート | 本番 DB（`InventoryMaster` / `TransactionLog` / `NotificationTargets` / `AllowList`） | `gulliver_database`。実行 SA を編集者として共有 |
| 通知用 Gmail アカウント | 在庫アラートメールの送信元（FR-09） | 既存アカウント可。2段階認証＋アプリパスワードで SMTP 送信（`smtp.gmail.com:465`、`nodemailer`） |

構成図は [overview.md](../architecture/overview.md) 2章を参照。

---

## 2. 前提

- `gcloud` CLI がインストール済みで、対象プロジェクトの Owner（または Cloud Run 管理者＋ SA 管理者＋ Storage 管理者＋ Secret Manager 管理者）権限を持つアカウントでログイン済み。
- プロジェクトに課金アカウントが紐づいている（無料枠内で運用するが、Cloud Run / GCS は課金アカウント必須）。
- Node.js LTS（検証時は v24）でローカルビルドが通る状態。

```bash
gcloud config set project inventory-system-507404
export REGION=asia-northeast1
```

---

## 3. インフラ構築手順

### 3.1 API 有効化

```bash
gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  storage.googleapis.com secretmanager.googleapis.com \
  sheets.googleapis.com
```

### 3.2 実行サービスアカウント

```bash
gcloud iam service-accounts create inventory-run \
  --display-name="inventory-system Cloud Run runtime"
export RUN_SA=inventory-run@inventory-system-507404.iam.gserviceaccount.com
```

付与するロール（最小権限）：

| 対象 | ロール | 目的 |
|---|---|---|
| バケット（3.3） | `roles/storage.objectAdmin` | `locks/` `pending/` の読み書き・条件付き作成／削除 |
| 各シークレット（3.5） | `roles/secretmanager.secretAccessor` | Gmail アプリパスワードの読み取り |
| プロジェクト | `roles/logging.logWriter` | サーバログ出力（専用 SA では明示付与） |

スプレッドシートへのアクセスは IAM ではなく **スプレッドシートの共有設定**で行う（3.4）。

### 3.3 Cloud Storage バケット

```bash
export BUCKET=inventory-system-507404-state
gcloud storage buckets create gs://$BUCKET \
  --location=$REGION --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member="serviceAccount:$RUN_SA" --role="roles/storage.objectAdmin"
```

- プレフィックス設計：`locks/inventory.lock`（[overview.md](../architecture/overview.md) 6.1）、`pending/{ISO8601}-{rand}.json`（6.2）、`pending/alerts/{itemId}.json`（4.4）。バケットは1つ、プレフィックスで用途を分ける。
- ライフサイクル：`pending/` は時差更新の元データなので**自動削除の対象にしない**。`locks/` はアプリが解放するが、スタックロック残骸に備えた保険として「作成1日で自動削除」を設定してもよい（任意）。

```bash
# 任意：locks/ の保険的な TTL
printf '%s' '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1,"matchesPrefix":["locks/"]}}]}' > /tmp/lifecycle.json
gcloud storage buckets update gs://$BUCKET --lifecycle-file=/tmp/lifecycle.json
```

### 3.4 スプレッドシート

1. `gulliver_database` に4シート（`InventoryMaster` / `TransactionLog` / `NotificationTargets` / `AllowList`）を作成し、各シート1行目に [database.md](../architecture/database.md) の列名でヘッダー行を置く。
2. スプレッドシートの「共有」で、**実行 SA のメールアドレス（`inventory-run@…`）を編集者**として追加する。
3. スプレッドシートID（URL の `/d/` と `/edit` の間）を控える → `GOOGLE_SPREADSHEET_ID`。

### 3.5 通知用 Gmail のアプリパスワード（FR-09 / 技術検証 検証3）

> OAuth2（旧方式）はテスト公開ステータスでリフレッシュトークンが約7日で失効し、恒久運用には Google の審査が必要だったため不採用。既存アカウントに2段階認証＋アプリパスワードを設定するだけの SMTP 方式を採る。

1. 送信元にする Gmail アカウント（既存アカウントで可）で2段階認証を有効化。
2. myaccount.google.com/apppasswords でアプリパスワードを発行（アプリ「メール」、デバイス「その他」）。
3. シークレット登録：

```bash
printf '%s' "$GMAIL_APP_PASSWORD" | gcloud secrets create gmail-app-password --data-file=-
gcloud secrets add-iam-policy-binding gmail-app-password \
  --member="serviceAccount:$RUN_SA" --role="roles/secretmanager.secretAccessor"
```

送信元アドレスは環境変数 `GMAIL_SENDER` で渡す。送信は `nodemailer` で `smtp.gmail.com:465`（`secure: true`）に対して行う。

---

## 4. ビルドとデプロイ

### 4.1 ビルド方式（方針確定：Dockerfile は書かない）

**`gcloud run deploy --source=./src`（4.3）で Cloud Run 標準の Google Cloud Buildpacks に自動ビルドさせる。** Dockerfile は用意しない。

- `nuxt.config.ts` の `nitro.preset` は既定の `node-server` のままでよい（Dockerfile の有無に関わらず `.output/server/index.mjs` を Node で起動する構成なので、buildpacks 利用に追加の変更は不要）。
- buildpacks は `package.json` を見てビルド・起動する。以下を明記しておく：
  - `engines.node`：技術検証で使用した Node バージョンに合わせて固定（例 `"engines": { "node": "22" }`）。指定が無いと buildpacks 既定バージョンが使われ、ローカル検証環境とずれる可能性がある。
  - `scripts.build`：`nuxt build`（`.output/` を生成）
  - `scripts.start`：`node .output/server/index.mjs`
  - buildpacks は `build` スクリプトがあれば自動実行し、`start` スクリプト（無ければ `Procfile`）を起動コマンドにする。
- 懸念点：buildpacks のビルドはリポジトリ内の Dockerfile 相当のキャッシュ最適化がなく、Dockerfile を書く場合より初回ビルドが遅くなることがある。1人開発・低頻度デプロイの本プロジェクトでは許容範囲と判断。ビルドが安定しない場合は Dockerfile 化を再検討する。

### 4.2 環境変数 / `runtimeConfig` マッピング

| 変数 | 取得元 | 用途 |
|---|---|---|
| `GOOGLE_SPREADSHEET_ID` | 環境変数 | DB スプレッドシートID |
| `GCS_BUCKET` | 環境変数 | 状態バケット名 |
| `GMAIL_SENDER` | 環境変数 | 通知メールの送信元アドレス |
| `GMAIL_APP_PASSWORD` | Secret Manager | Gmail SMTP 送信用アプリパスワード |
| Sheets / GCS の認証 | 実行 SA のアタッチ（ADC）で鍵ファイル不要 | SA鍵を使う場合は Secret Manager 経由で `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` を渡す（[overview.md](../architecture/overview.md) 2.2）。ローカル開発は 7章 |

すべて `nuxt.config.ts` の `runtimeConfig` で読み込む（[overview.md](../architecture/overview.md) 2.2）。

### 4.3 デプロイコマンド

```bash
gcloud run deploy inventory-system \
  --source=./src \
  --region=$REGION \
  --service-account=$RUN_SA \
  --max-instances=1 \
  --min-instances=0 \
  --concurrency=20 \
  --cpu=1 --memory=512Mi \
  --allow-unauthenticated \
  --set-env-vars=GOOGLE_SPREADSHEET_ID=xxxx,GCS_BUCKET=$BUCKET,GMAIL_SENDER=notify@example.com \
  --set-secrets=GMAIL_APP_PASSWORD=gmail-app-password:latest
```

- `--max-instances=1` は**必須**（排他制御の多重防御。[overview.md](../architecture/overview.md) 6.1）。
- `--concurrency=20`：利用者最大10名（NR-01）に対し十分。
- `--allow-unauthenticated`：認証はアプリ内の AllowList / セッションで行うため、Cloud Run 側は公開でよい（利用者を IAM で管理しない）。
- `--min-instances=0`：コスト優先（NR-04）。日初回アクセスのコールドスタートは許容。

### 4.4 セッション永続化（暫定）

セッションは `src/data/sessions.json`（インスタンス内ファイル）で、再デプロイ・インスタンス再作成で消える。**方針確定：再デプロイ時は全員が次操作で `SESSION_INVALID` → 再ログインで運用する**（外部ストア化はしない。[overview.md](../architecture/overview.md) 6.3）。デプロイは業務時間外に行うのが望ましい。

---

## 5. 初回セットアップ

1. `AllowList` に管理者2名を含む初期ユーザを登録する。パスワードは `npm run hash-password` に手入力して bcrypt ハッシュを生成し、`passwordHash` 列へ貼り付ける（要件3-1）。管理者は `targetId` 列に通知先IDを設定。
2. `NotificationTargets` にアラート受信アドレスを登録（デプロイ後に D-05 / D-10 から追加してもよい）。
3. デプロイ後、6章の疎通確認を実施。

---

## 6. デプロイ後の疎通確認（技術検証の「実装前 TODO」）

| # | 確認 | 対応する技術検証 |
|---|---|---|
| 1 | 実行 SA で GCS バケットへ JSON 作成／`ifGenerationMatch=0` ロックの取得・解放・強制奪取が往復する | 検証1・検証2（`01_gcs_bucket.mjs` 再実行） |
| 2 | 通知用 Gmail から通知先アドレスへ実際に1通送信でき、日次カウントが動く | 検証3 |
| 3 | 実機（iOS Safari / Android Chrome）で D-03 のカメラ起動・JAN/GS1 読み取り・GTIN 抽出 | 検証4 |
| 4 | D-04 の QR 印刷レイアウト（ラベル用紙サイズ・クワイエットゾーン）を実機印刷で確認 | 検証4 |

---

## 7. ローカル開発環境

- `src/.env` に `GOOGLE_SPREADSHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`（検証用 SA 鍵）/ `GCS_BUCKET` / `GMAIL_*` を設定（`.env` はリポジトリに含めない）。
- ローカルからは検証用 SA 鍵で Sheets / GCS にアクセス。GCS は本番と同じバケット、または開発用に別バケットを作成。
- `npm run dev` で起動。カメラ機能は `localhost`（セキュアコンテキスト扱い）で動作する。

---

## 8. 更新デプロイ / ロールバック

- 更新：4.3 の `gcloud run deploy` を再実行（新リビジョンが作成され、トラフィックが自動で切り替わる）。
- ロールバック：`gcloud run services update-traffic inventory-system --to-revisions=<前リビジョン>=100`。
- 環境変数・シークレットのみの変更は `gcloud run services update` で可能。

---

## 9. コスト（NR-04）

| サービス | 想定 | 無料枠 |
|---|---|---|
| Cloud Run | 10名・低頻度、`min-instances=0` | 月200万リクエスト・vCPU/メモリ秒とも十分収まる |
| Cloud Storage | 数MB・少量操作 | 5GB/月・少量オペレーション |
| Sheets API | 60 req/分/ユーザの範囲（[overview.md](../architecture/overview.md) 6.7） | 無料 |
| Gmail 送信 | 1日数通 | 無料 Gmail 500通/日 |

`min-instances=1` にすると常時インスタンスぶんが課金されるため、コスト優先なら 0 のままとする。
