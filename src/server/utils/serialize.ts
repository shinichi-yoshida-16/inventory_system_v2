// ロジック層: 単一インスタンス内の書き込み処理を直列化する（overview.md 6.1）。
// 在庫マスタ/TransactionLog/AllowList/GCSを書き込む処理は、この1本のPromiseチェーンに載せる。
// ライブラリ(async-mutex等)は使わない。

let chain: Promise<unknown> = Promise.resolve()

/**
 * taskを直列チェーンの末尾に載せて実行する。先行タスクの失敗はこのタスクの実行を妨げない。
 */
export function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.catch(() => undefined).then(task)
  chain = result.catch(() => undefined)
  return result
}
