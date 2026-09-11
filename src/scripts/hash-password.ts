// bcryptハッシュ生成CLI（要件3-1）。`npm run hash-password` で起動し、
// 手入力したパスワードのbcryptハッシュを標準出力へ表示する。
// 生成したハッシュは、Googleスプレッドシートの許可リスト(AllowList)C列へ手作業で転記する。
import bcrypt from 'bcryptjs'
import { stdin, stdout } from 'node:process'

const BCRYPT_ROUNDS = 10
const CTRL_C = ''
const BACKSPACE_1 = ''
const BACKSPACE_2 = ''

function readPasswordMasked(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(prompt)
    let password = ''
    const onData = (buf: Buffer) => {
      const char = buf.toString('utf8')
      if (char === '\n' || char === '\r') {
        stdin.setRawMode?.(false)
        stdin.pause()
        stdin.removeListener('data', onData)
        stdout.write('\n')
        resolve(password)
        return
      }
      if (char === CTRL_C) {
        stdout.write('\n')
        process.exit(1)
      }
      if (char === BACKSPACE_1 || char === BACKSPACE_2) {
        password = password.slice(0, -1)
        return
      }
      password += char
    }
    stdin.resume()
    stdin.setRawMode?.(true)
    stdin.on('data', onData)
  })
}

async function main() {
  const password = await readPasswordMasked('パスワードを入力してください（入力は非表示）: ')
  const confirm = await readPasswordMasked('確認のためもう一度入力してください: ')

  if (password.length < 8 || password.length > 72) {
    console.error('パスワードは8〜72文字で入力してください')
    process.exit(1)
  }
  if (password !== confirm) {
    console.error('入力が一致しません')
    process.exit(1)
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  console.log('\n生成したbcryptハッシュ（AllowListのC列にこの文字列を転記してください）:\n')
  console.log(hash)
}

await main()
process.exit(0)
