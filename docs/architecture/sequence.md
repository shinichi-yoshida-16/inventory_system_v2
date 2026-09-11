# セッション設計 / シーケンス設計

- 対象システム：整備部品在庫管理システムv2
- 本書の位置付け：セッション設計・主要処理フローの詳細設計（要件定義 9章「開発フロー」4.シーケンス作成にあたる）
- 対応要件：[requestment.md](../requirements/requestment.md)、全体構成：[overview.md](overview.md)、データ設計：[database.md](database.md)、画面設計：[transition.md](transition.md)

> **アーキテクチャ前提（[overview.md](overview.md) と共通）**
> 本システムは **単一の Nuxt4 アプリ（TypeScript / Vue3）を Google Cloud（Cloud Run、`max-instances=1`）にデプロイし、`googleapis` から Google スプレッドシートを DB として操作する**構成をとる（要件6章）。
> 旧構成（GAS Web App ＋ 外部ホスティングの2ドメイン、`CacheService` / `LockService` / `GmailApp`、URLパラメータでのトークン受け渡し）は**用いない**。本書は 2026-09-10 に旧GAS版から新構成へ改訂した。

登場要素（[overview.md](overview.md) 2章・3.1節に対応）:

| 記号 | 対応 | 層 |
|---|---|---|
| FE | `src/app/pages/*.vue`（Vue3） | フロントエンド |
| Auth | `src/app/composables/useAuth.ts`（`useState`） | 状態管理層（FE） |
| API | `src/server/api/**/*.ts`（Nitro ルート） | API層 |
| Logic | `src/server/utils/{session,inventory,alert,lock,deferredSync}.ts` | ロジック層 |
| DAO | `src/server/utils/{sheets,gcs}.ts` | データアクセス層 |
| SS | Google スプレッドシート（`InventoryMaster` / `TransactionLog` / `NotificationTargets` / `AllowList`） | 外部 |
| GCS | Cloud Storage（`locks/` 排他ロック、`pending/` 時差更新の蓄積データ、`pending/alerts/` 通知マージ対象） | 外部 |
| Gmail | 通知用 Gmail アカウント（アプリパスワード、SMTP送信） | 外部 |

---

## 1. セッション設計

### 1.1 セッションのライフサイクル

```mermaid
sequenceDiagram
    participant U as 利用者
    participant FE as FE(app/pages)
    participant Auth as useAuth(useState)
    participant API as API層(server/api)
    participant Logic as session.ts(ロジック層)
    participant DAO as sheets.ts(DAO)
    participant Store as sessions.json

    U->>FE: メールアドレス・パスワード入力（D-00）
    FE->>API: POST /api/auth/login { email, password }
    API->>Logic: 認証を委譲
    Logic->>DAO: AllowList 照合（email）
    DAO-->>Logic: 許可行（passwordHash / targetId / retiredFlag）
    alt 未登録 / bcryptjs 不一致 / retiredFlag=true
        Logic-->>API: 認証失敗
        API-->>FE: status:ERROR, code:AUTH_FAILED（同一メッセージ）
        FE-->>U: エラー表示（D-00 にとどまる）
    else 認証OK
        Logic->>Logic: セッションID（UUID）+ 有効期限（30分）を発行
        Logic->>Store: セッションを保存
        opt 管理者 かつ pending/alerts/ にマージ対象あり
            Logic->>DAO: pending/alerts/ を取得し、保留分を1通にまとめて通知先へ送信<br/>送信成功で対象 itemId の alertSentFlag=true にし pending/alerts/ を削除（FR-09、overview.md 4.4 / 6.4）
        end
        Logic-->>API: sessionId, user（email / 管理者判定=targetId 有無）
        API-->>FE: status:OK, data:{ sessionId, user }
        FE->>Auth: sessionId・user を useState に保持
        FE-->>U: D-01 ダッシュボードへ遷移
    end

    Note over FE,API: 以降の全業務APIは x-session-id ヘッダを付与
    U->>FE: 画面操作（D-01〜D-10）
    FE->>API: 業務API 呼び出し（x-session-id）
    API->>Logic: validateSession(sessionId)
    alt 有効
        Logic->>Store: 有効期限を +30分 に延長
        Logic-->>API: OK（操作者 email を解決）
        API-->>FE: status:OK, data
    else 無効／期限切れ
        Logic->>Store: 当該セッションを破棄
        Logic-->>API: NG
        API-->>FE: status:ERROR, code:SESSION_INVALID
        FE->>Auth: useState の保持値をクリア
        FE-->>U: D-00 へ強制遷移
    end

    U->>FE: ログアウト押下
    FE->>API: POST /api/auth/logout（x-session-id）
    API->>Logic: セッション破棄
    Logic->>Store: 当該セッションを削除
    API-->>FE: status:OK
    FE->>Auth: useState をクリア → D-00 へ
```

### 1.2 設計上の要点（要件 3-2 / 3-3、[overview.md](overview.md) 6.3 の具体化）

- 有効期限：30分。ログイン発行時に設定し、`GET /api/auth/user` を含む業務API のたびに検証時点から +30分 へ延長する（要件 3-3）。
- 期限切れセッションは検証時に破棄し、クライアントは操作画面を問わず D-00 へ強制遷移して状態管理層（`useAuth` / `useState`）の保持値をクリアする（要件 3-3、[transition.md](transition.md) 2章）。
- セッションIDは推測困難なランダム文字列（UUID）とし、メールアドレス等の個人情報を含めない。
- 操作者（メールアドレス）はサーバがセッションから解決し、クライアントからは受け取らない（なりすまし面の縮小、FR-06 / FR-07）。
- なりすまし対策は検証レベルの許容リスクとして行わない（NR-03、要件10章）。
- 認証失敗（未登録・パスワード不一致・退職フラグ true）は同一メッセージ（`AUTH_FAILED`）で返す（列挙攻撃対策、FR-01）。
- 管理者のログイン成功時に、Gmail 上限等で保留されたアラート通知（`pending/alerts/`）があればまとめて送信し、送信成功で対象 `itemId` の `alertSentFlag` を true にして削除する（FR-09、[overview.md](overview.md) 4.4 / 6.4）。「翌日以降のマージ送信」はこの管理者ログインを契機とし、スケジューラは用いない。

### 1.3 セッション永続化（方針確定 2026-09-11）

- セッション実体は `src/data/sessions.json`（サーバ上のファイル＝単一インスタンスのメモリ相当）。Cloud Run のファイルシステムはエフェメラルで、再デプロイ・インスタンス再作成で消失する。
- **消失時は全利用者が次操作で `SESSION_INVALID` → D-00 で再ログインする運用を許容する**（業務停止ではない）。外部ストア（GCS / Firestore / 署名済み Cookie）への移行はしない。詳細は [overview.md](overview.md) 6.3。

---

## 2. シーケンス設計

### 2.1 出庫処理シーケンス（D-03 起点、FR-06・FR-09 該当）

```mermaid
sequenceDiagram
    participant U as 整備士(スマホ, D-03)
    participant FE as FE(inport_qr.vue)
    participant API as API層(server/api)
    participant Logic as inventory.ts(ロジック層)
    participant Lock as lock.ts(ロジック層)
    participant DAO as sheets.ts / gcs.ts(DAO)
    participant GCS as Cloud Storage(locks/ pending/ pending/alerts/)
    participant SS as スプレッドシート
    participant Alert as alert.ts → Gmail

    U->>FE: コード読取 → itemId／GTIN 正規化（overview.md 4.5節）
    FE->>API: GET /api/inventory/{itemIdまたはgtin}（x-session-id）
    API->>API: validateSession
    API->>Logic: 品目取得を委譲
    Logic->>DAO: 在庫マスタ検索（itemId 列 → 一致なければ gtin 列）
    DAO->>SS: 読み取り
    SS-->>DAO: 品目情報
    API-->>FE: status:OK, data（実在する itemId・品目名・現在在庫数）
    FE-->>U: 確認画面（数量・種別入力、transition.md 5.3）<br/>※以降は応答の itemId を使用

    U->>FE: 出庫数量入力 → 登録押下
    FE->>API: POST /api/scan { itemId, type:OUT, quantity }（x-session-id）
    API->>API: validateSession → 操作者 email をセッションから解決
    API->>Logic: 出庫処理を委譲
    Logic->>Lock: acquireLock("locks/inventory.lock")
    Lock->>GCS: objects.insert(ifGenerationMatch=0)

    alt ロック取得できず（HTTP 412）＋ タイムアウト（5〜10秒）超過
        Lock-->>Logic: 取得失敗
        Logic->>Logic: operationId 採番（UUID）
        Logic->>DAO: pending/{ISO8601}-{rand}.json 退避<br/>{ operationId, itemId, type:OUT, quantity, operator, occurredAt }
        DAO->>GCS: 蓄積データ保存
        Logic-->>API: status:ERROR, code:LOCK_TIMEOUT
        API-->>FE: 「時差更新として受け付けました」
        FE-->>U: 完了扱いで D-03 にとどまる
    else ロック取得成功
        GCS-->>Lock: generation
        Lock-->>Logic: ロック取得
        Logic->>DAO: 在庫マスタ取得（itemId、batchGet）
        DAO->>SS: 読み取り
        SS-->>DAO: 現在在庫数 / 閾値 / alertSentFlag
        alt 出庫数量 > 現在在庫数
            Logic->>Lock: releaseLock
            Logic-->>API: status:ERROR, code:INSUFFICIENT_STOCK
            API-->>FE: 在庫不足（在庫マスタ・履歴とも未更新）
            FE-->>U: 確認画面にエラー表示
        else 出庫可能
            Logic->>Logic: operationId 採番（UUID）／更新後在庫数 = 現在在庫数 - quantity（FR-06）
            Logic->>DAO: TransactionLog に1行追加（operationId, type=OUT, quantity, userEmail=operator）
            Logic->>DAO: 在庫マスタ更新（currentStock, updatedAt。batchUpdate）
            DAO->>SS: 書き込み（履歴 → 在庫マスタ の順）
            Logic->>Logic: 閾値判定 → アラート送信要否を確定<br/>（更新後在庫数 < 閾値 かつ alertSentFlag=false なら「送信要」）
            Logic->>Lock: releaseLock（objects.delete, ifGenerationMatch=generation）
            Lock->>GCS: ロック解放
            alt 書き込み失敗（SHEET_WRITE_FAILED）
                Logic->>DAO: pending/{ISO8601}-{rand}.json 退避<br/>{ operationId, itemId, type:OUT, quantity, operator, occurredAt }
                DAO->>GCS: 蓄積データ保存（時差更新対象。operationId で冪等適用）
                API-->>FE: 「時差更新として受け付けました」
            else 書き込み成功
                opt 送信要（ロック解放後の独立系）
                    Logic->>Alert: 通知先設定（NotificationTargets）の全アドレスへ送信
                    alt 送信成功
                        Alert->>DAO: InventoryMaster.alertSentFlag = true
                    else 送信失敗（HTTP 429 / RESOURCE_EXHAUSTED 含む）
                        Alert->>DAO: pending/alerts/{itemId}.json 退避<br/>{ itemId, itemName, threshold, detectedStock, detectedAt }（alertSentFlag は false のまま）
                        DAO->>GCS: マージ対象保存（管理者ログイン時に送信、overview.md 6.4）
                    end
                end
                Logic-->>API: 処理結果（更新後在庫数）
                API-->>FE: status:OK, data
            end
            FE-->>U: 完了表示（D-03 にとどまる）
        end
    end
```

- ロック取得 → 在庫不足チェック → 履歴追記（`operationId` 付き）→ 在庫マスタ更新（1回の `batchUpdate`）→ アラート送信要否の確定 までを一連で行い、`finally` で必ずロックを解放する（[overview.md](overview.md) 5章）。**履歴を先に確定し、在庫マスタはそれと整合する値へ更新する**（部分失敗時、`operationId` の冪等判定で二重計上を防ぐ。2.6 参照）。
- 出庫数量が現在在庫数を超える場合は `INSUFFICIENT_STOCK` で拒否し、在庫マスタ・履歴とも更新しない（マイナス在庫を作らず、記録数量＝実減算数量とする、FR-06）。
- 旧構成の `SpreadsheetApp.flush()` は不要。`googleapis` は各書き込みの HTTP 応答を同期的に待つため、応答受領をもって反映確定とみなす。
- アラートメールの送信と `alertSentFlag` の更新はロック解放後の独立系とし、失敗しても在庫更新自体は成功として返す。送信成功で `alertSentFlag=true`、送信失敗（HTTP 429 含む）は `pending/alerts/{itemId}.json` へ退避し管理者ログイン時にマージ送信する（[overview.md](overview.md) 4.4 / 6.4）。並行入出庫でまれに重複通知が起こり得るが検証グレードの許容リスクとする（なりすまし等と同様、NR-03 / 要件10章）。

### 2.2 入庫処理シーケンス（FR-07 該当）の差分

出庫（2.1）と同一のトランザクション構造だが、以下が異なる。

- 現在在庫数は `+= quantity`。在庫不足チェック（`INSUFFICIENT_STOCK`）は不要。
- 閾値判定は「入庫後に閾値以上（更新後在庫数 ≧ 閾値）へ回復したか」を見る。
- 回復し、かつ `alertSentFlag=true` の場合、**ロック区間内の在庫マスタ更新（`batchUpdate`）に含めて** `alertSentFlag` を `true → false` に戻す（再度閾値を下回った際に再通知できるようにする、要件 3-9）。あわせて `pending/alerts/{itemId}.json`（未送信のマージ対象）があれば削除する。
- 入庫では在庫が減らないためアラートメール送信は発生しない。
- `operationId` の採番、履歴→在庫マスタの順序、書き込み失敗時の `pending/` 退避は出庫（2.1）と同じ。

### 2.3 排他制御の要点（技術検証「検証2」の反映、FR-14）

- スプレッドシート単体では条件付き書き込みAPIが無く並行更新で lost update が起きるため、DB の外に排他機構を持つ。
- **主機構：GCS オブジェクトロック**（パラメータの詳細は [overview.md](overview.md) 6.1）
  - 取得：`objects.insert(name="locks/inventory.lock", ifGenerationMatch=0, body={ owner, acquiredAt })`。成功でロック取得（`generation` 保持）、HTTP 412 なら待機・再試行（200ms→指数バックオフ、上限1s、±20%ジッタ）。
  - タイムアウト：合計 **8秒**。入出庫は `pending/` へ退避して即応答（`LOCK_TIMEOUT`）。それ以外はエラー返却。
  - 解放：保持した `generation` を条件に `objects.delete(ifGenerationMatch=generation)`。412 なら奪取済みで何もしない。`finally` で必ず試みる。
  - スタックロック対策：本文の `acquiredAt` が **30秒**超なら `ifGenerationMatch=<現generation>` 付きで強制奪取。
- **`locks/inventory.lock` はスプレッドシート書き込み全般の直列化ロック**。入出庫に加え、閾値設定・廃番フラグ更新・新規品目登録・通知先追加（`TAR-` 採番）も取得してから書き込む（現場スキャンとの lost update を防ぐ）。入出庫以外は取得不可なら時差更新に落とさず `LOCK_TIMEOUT` エラー（[overview.md](overview.md) 6.1）。パスワード更新（`AllowList`）はロック対象外。
- **多重防御：Cloud Run `max-instances=1` ＋ インスタンス内直列化**（`server/utils/serialize.ts` の単一 Promise チェーン。ライブラリ不使用。[overview.md](overview.md) 6.1）。SA 単位の Sheets クォータ対策は [overview.md](overview.md) 6.7。
- 管理者のスプレッドシート直接編集は排他対象外（要件10章、運用でカバー）。
- 将来、ロック層のみ Firestore（ネイティブトランザクション）へ寄せる余地を残す（NR-06、[overview.md](overview.md) 6.1）。

### 2.4 ログインシーケンス（1.1 と対応）

ログイン自体のフローは「1.1 セッションのライフサイクル」の前半（`POST /api/auth/login`）と同一のため、本節では重複させず 1.1 を参照する。

### 2.5 未登録品目スキャン時の自動登録シーケンス（FR-12 該当）

```mermaid
sequenceDiagram
    participant U as 整備士(スマホ, D-03)
    participant FE as FE(inport_qr.vue)
    participant API as API層(server/api)
    participant Logic as inventory.ts(ロジック層)
    participant Lock as lock.ts(ロジック層)
    participant DAO as sheets.ts / gcs.ts(DAO)
    participant GCS as Cloud Storage(locks/)
    participant SS as スプレッドシート

    U->>FE: コード読取（JAN / GS1 DataMatrix）
    FE->>FE: フォーマット判定・GTIN 正規化（overview.md 4.5節）
    FE->>API: GET /api/inventory/{gtin}（x-session-id）
    API->>Logic: 品目検索を委譲
    Logic->>DAO: 在庫マスタ検索（itemId 列 → gtin 列）
    DAO->>SS: 読み取り
    SS-->>DAO: 該当なし
    Logic-->>API: status:ERROR, code:ITEM_NOT_FOUND
    API-->>FE: 未登録
    FE-->>U: 新規登録フォーム表示（品目名・閾値・保管場所）。読み取った GTIN は保持しておく

    U->>FE: 登録情報入力 → 登録押下
    FE->>API: POST /api/scan { gtin, type:IN, quantity:1, itemName, threshold, location }（x-session-id）
    API->>API: validateSession → 操作者 email を解決
    API->>Logic: 登録＋入庫処理を委譲
    Logic->>Lock: acquireLock("locks/inventory.lock")
    Lock->>GCS: objects.insert(ifGenerationMatch=0)
    alt ロック取得できず（タイムアウト）
        Lock-->>Logic: 取得失敗
        Logic-->>API: status:ERROR, code:LOCK_TIMEOUT
        API-->>FE: エラー表示（新規登録は時差更新に落とさない。再実行を促す）
    else ロック取得成功
        GCS-->>Lock: generation
        Lock-->>Logic: ロック取得
        Logic->>DAO: 在庫マスタ再検索（gtin）※未登録を再確認
        DAO->>SS: 読み取り
        SS-->>DAO: 該当なし（登録可）
        Logic->>Logic: itemId 採番（ITM- の最大連番+1）／operationId 採番（UUID）／在庫数 = 0 + 1（通常の入庫計算式に合流）
        Logic->>DAO: TransactionLog に1行追加（operationId, itemId, type=IN, quantity=1, userEmail=operator）
        Logic->>DAO: 在庫マスタへ新規行追加<br/>（itemId, gtin, currentStock=1, threshold, location, alertSentFlag=FALSE, discontinuedFlag=FALSE, updatedAt）
        DAO->>SS: 書き込み（履歴 → 在庫マスタ の順）
        Logic->>Lock: releaseLock（ifGenerationMatch=generation）
        Lock->>GCS: ロック解放
        Logic-->>API: 処理結果（itemId, 現在在庫数=1）
        API-->>FE: status:OK, data
        FE-->>U: 登録完了表示（D-03 にとどまる）
    end
```

- 「未登録判定」から「新規行追加」までを同一のロック区間内で行い、確認（`GET /api/inventory/{gtin}`）と登録（`POST /api/scan`）の間の割り込みによるレース条件を避ける。`GET` での未登録判定はあくまで画面分岐用の参考情報であり、登録可否は `POST /api/scan` 内で再判定する（[overview.md](overview.md) 5章、[transition.md](transition.md) 5.3）。
- 新規登録時は種別を `IN` 固定とし、`OUT` は拒否する（存在しない品目からの出庫を防止するため、FR-12）。在庫数 0 のままでの登録は行わない。
- **新規登録はロックを取得できなければ即時エラー（`LOCK_TIMEOUT`）とし、時差更新（`pending/`）には落とさない**。蓄積データのスキーマは入出庫用（`{ operationId, itemId, type, quantity, operator, occurredAt }`）で品目名・閾値・保管場所を保持できず、後追い適用時に itemId が存在せず失敗し続けるため。ユーザには再実行を促す（要件 3-5）。
- **登録経路によらず `itemId` は `ITM-` の最大連番+1 をサーバがロック区間内で採番する**（[overview.md](overview.md) 6.1 / 4.3）。D-03（バーコード読み取り）経由では、あわせて読み取った GTIN-14 を `gtin` 列に保持する。D-04（自社発行QR）経由の新規登録は `gtin` を送らない（メーカーバーコードを持たない品目）。採番した `itemId` はレスポンス（`data.itemId`）で返し、D-04 のクライアントはその値で QR を生成する。
- 登録済み品目の通常の入出庫は 2.1・2.2 と同一（識別コードの取得元が自社発行QRかJAN/DataMatrixかを問わず、`GET` の応答で得た `itemId` を使う）。

### 2.6 時差更新（蓄積データの後追い適用）シーケンス（FR-15・要件 3-12 該当）

```mermaid
sequenceDiagram
    participant Adm as 管理者級整備士(PC, D-05)
    participant FE as FE(threshold.vue)
    participant API as POST /api/deferred-sync(API層)
    participant Sync as deferredSync.ts(ロジック層)
    participant Lock as lock.ts(ロジック層)
    participant DAO as sheets.ts / gcs.ts(DAO)
    participant GCS as Cloud Storage(pending/)
    participant SS as スプレッドシート

    Note over FE: pending/ に蓄積データがある場合のみ<br/>時差更新ボタンを活性化（transition.md 3章）
    Adm->>FE: 時差更新ボタン押下
    FE->>API: POST /api/deferred-sync（x-session-id）
    API->>API: validateSession → AllowList 再解決で管理者判定（targetId 有無）
    alt 非管理者
        API-->>FE: status:ERROR, code:PERMISSION_DENIED（HTTP 403）
    else 管理者
        API->>Sync: 後追い適用を委譲
        Sync->>DAO: pending/ 直下の一覧取得（デリミタ "/"。pending/alerts/ は除外）
        DAO->>GCS: 一覧
        GCS-->>DAO: オブジェクト名リスト（名前＝ISO8601 順＝時系列順）
        loop 名前順に1件ずつ（1件ごとに間隔を空け、RESOURCE_EXHAUSTED は指数バックオフ）
            Sync->>Lock: acquireLock("locks/inventory.lock")
            Lock-->>Sync: ロック取得
            Sync->>DAO: TransactionLog に operationId 既存か確認
            alt 適用済み（同 operationId あり）
                Sync->>DAO: 在庫マスタのみ整合値へ再計算・更新（履歴は追記しない）
            else 未適用
                Sync->>DAO: 在庫マスタ取得 → 在庫数 ±= quantity（type で加減）<br/>TransactionLog に1行追加（operationId, operator, occurredAt）→ 在庫マスタ更新（履歴 → 在庫マスタ の順、batchUpdate）
            end
            DAO->>SS: 書き込み
            Sync->>Sync: 閾値判定・アラート送信要否（2.1 と同じ規則。送信失敗は pending/alerts/ へ）
            Sync->>Lock: releaseLock
            alt 適用成功
                Sync->>DAO: 当該 pending/ オブジェクトを削除
                DAO->>GCS: delete
            else 適用失敗
                Note over Sync: 当該オブジェクトは保持（次回再実施の対象）
            end
        end
        Sync-->>API: 適用件数 / 残件数
        alt 残件 = 0
            API-->>FE: status:OK（全件完了）
            FE-->>Adm: 完了を通知・時差更新ボタンを非活性化
        else 残件あり
            API-->>FE: status:OK（未適用が残存）
            FE-->>Adm: 未適用が残っている旨を表示し、再実施を促す
        end
    end
```

- 蓄積データ（`pending/{ISO8601}-{rand}.json`）は `{ operationId, itemId, type:"IN"|"OUT", quantity, operator, occurredAt }`（`occurredAt` は UTC ISO8601）。名前順に適用することで時系列順の反映を担保する（[overview.md](overview.md) 6.2）。対象は入出庫のみ。
- 適用は 1操作 = 1ロック区間で行い、通常の入出庫（2.1・2.2）と同じ計算式・閾値判定に合流させる。
- **`operationId` で冪等に適用する。** `TransactionLog` に同 `operationId` の行が既にあれば（＝部分書き込み失敗時に履歴だけ確定していたケース）、履歴追記をスキップし在庫マスタのみ整合させる。二重計上を防ぐ（[database.md](database.md) 2章）。
- Sheets クォータ（60 req/分/SA、全利用者で共有）に収めるため、**1件処理ごとに約 1.5 秒空ける**。`RESOURCE_EXHAUSTED` は 2s→4s→8s の指数バックオフで最大3回、なお失敗ならその回を打ち切って残件を保持する（[overview.md](overview.md) 6.2 / 6.7）。
- すべて成功でユーザに完了通知、失敗が残れば蓄積データを保持して再実施を促す（要件 3-12）。最悪ケースは棚卸で在庫数を実数に合わせる運用（NR-02）。

### 2.7 ユーザ管理シーケンス（許可リスト閲覧・パスワードリセット、要件 3-10 該当）

```mermaid
sequenceDiagram
    participant U as 利用者（D-10）
    participant FE as FE(user_info.vue)
    participant API as API層(server/api)
    participant Logic as users.ts(ロジック層)
    participant DAO as sheets.ts(DAO)
    participant SS as スプレッドシート(AllowList)

    Note over FE: D-10 は端末不問。管理者のみ許可リスト欄を表示（useAuth の isAdmin）

    rect rgba(0,0,0,0.04)
    Note over U,SS: 自分のパスワード変更（一般ユーザ・管理者共通、FR-13）
    U->>FE: 新パスワード＋確認入力 → 更新
    FE->>API: PUT /api/user/password { newPassword, newPasswordConfirm }（x-session-id）
    API->>API: validateSession → 操作者 email を解決
    API->>API: 入力検証（8–72文字・一致）
    API->>Logic: パスワード更新を委譲（対象＝セッションの email）
    Logic->>Logic: bcrypt でハッシュ化
    Logic->>DAO: AllowList 該当行の passwordHash / updatedAt を更新
    DAO->>SS: 書き込み
    API-->>FE: status:OK
    end

    rect rgba(0,0,0,0.04)
    Note over U,SS: 許可リスト閲覧＋他ユーザのパスワードリセット（管理者のみ、3-10）
    U->>FE: D-10 の許可リスト欄を開く
    FE->>API: GET /api/users（x-session-id）
    API->>API: validateSession → AllowList 再解決で管理者判定
    alt 非管理者
        API-->>FE: status:ERROR, code:PERMISSION_DENIED（HTTP 403）
    else 管理者
        API->>Logic: 一覧取得を委譲
        Logic->>DAO: AllowList 全行取得
        DAO->>SS: 読み取り
        Logic-->>API: allowId / email / isAdmin(targetId有無) / retiredFlag / updatedAt（passwordHash は除外）
        API-->>FE: status:OK, data（ハッシュを含めない）
        FE-->>U: メールアドレス一覧を表示

        U->>FE: 対象ユーザ選択 → 新パスワード＋確認入力 → リセット
        FE->>API: PUT /api/users/{allowId}/password { newPassword, newPasswordConfirm }（x-session-id）
        API->>API: validateSession → 管理者判定（再チェック）／入力検証
        alt 非管理者 / allowId 不存在
            API-->>FE: status:ERROR（PERMISSION_DENIED / INVALID_INPUT）
        else OK
            API->>Logic: 対象 allowId のパスワード更新を委譲
            Logic->>Logic: bcrypt でハッシュ化
            Logic->>DAO: AllowList 該当行の passwordHash / updatedAt を更新
            DAO->>SS: 書き込み
            API-->>FE: status:OK
            FE-->>U: リセット完了を表示（本人への通知は行わない＝口頭等で伝達）
        end
    end
    end
```

- `GET /api/users` は `passwordHash` 列を**レスポンスに含めない**（平文は保持しないため、そもそも表示できるのはハッシュのみ。[overview.md](overview.md) 4.6）。
- パスワード更新（本人・管理者とも）は `AllowList` の単一行の 1〜2 セル更新で、ログイン照合キー（email）は変えないため `locks/inventory.lock` は取得しない（[overview.md](overview.md) 6.1）。
- ユーザ行の追加・削除・退職フラグ変更はスプレッドシートの直接編集で行う（要件10章）。この画面では扱わない。
- ロジックは `src/server/utils/users.ts`。`session.ts` のログイン照合とハッシュ生成ロジックを共用する。
