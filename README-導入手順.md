# Tahi Portal Admin — 導入手順

このZIPは、既存サイトを残しながら `/admin/` を追加するための実装パッケージです。
自宅PCを常時サーバーにする必要はありません。

## 含まれるもの
- `tahi-mirusen.github.io-main/` : GitHub Pages用サイト。既存の `site-data.json` と `uploads/` を維持
- `tahi-mirusen.github.io-main/admin/` : Material風の独立管理画面
- `cloudflare-worker/` : GitHub OAuth、管理者許可リスト、セッション、データ更新、簡易PV集計API

## 重要な注意
GitHub Pagesは静的ホスティングです。管理画面の認証とGitHub APIへの書き込みはCloudflare Workerで行います。
このパッケージは**デプロイ済みではありません**。CloudflareとGitHubの設定が完了するまではログイン・保存APIは動きません。
GitHub OAuth Client SecretやアクセストークンをHTML/JavaScriptに記載しないでください。

## 1. GitHub Pagesへ配置
1. GitHubリポジトリ `tahi-mirusen/tahi-mirusen.github.io` の現在の内容をバックアップ。
2. ZIP内の `tahi-mirusen.github.io-main/` の中身をリポジトリの `main` ブランチ直下へ配置。
3. 既存の `site-data.json` と `uploads/` を上書きする場合は、必ず内容を比較してからにしてください。
4. `admin/config.js` の `ADMIN_API_URL` はWorkerデプロイ後に編集します。

## 2. Cloudflare Workerを作成（無料枠の範囲で利用可能）
1. Cloudflareアカウントを作成。
2. Workers & PagesでWorkerを作成し、`cloudflare-worker/worker.js` をデプロイ。
3. KV Namespaceを作成し、名前を `SESSIONS` としてWorkerにバインド。
4. `wrangler.toml` の `id` をKV Namespace IDに変更するか、Cloudflareダッシュボードで同じバインディングを追加。
5. WorkerのVariables/Secretsに以下を設定。

通常のVariables:
- `GITHUB_CLIENT_ID`
- `GITHUB_CALLBACK_URL` = `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/auth/callback`
- `ALLOWED_GITHUB_LOGINS` = 許可するGitHubログイン名（例: `your-github-login`）
- `REPO_OWNER` = `tahi-mirusen`
- `REPO_NAME` = `tahi-mirusen.github.io`
- `REPO_BRANCH` = `main`

Secrets:
- `GITHUB_CLIENT_SECRET`

Workerの `workers.dev` URLを控えます。

## 3. GitHub OAuth Appを作成
GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
- Application name: Tahi Admin
- Homepage URL: `https://tahi-mirusen.github.io/`
- Authorization callback URL: 上記 `GITHUB_CALLBACK_URL`
- Enable Device Flow: 不要

OAuth AppのClient IDをWorkerの `GITHUB_CLIENT_ID` に設定し、Client SecretはSecretとして登録。
この実装は `public_repo` と `read:user` のOAuth scopeを要求します。公開リポジトリへの書き込み権限を許可する必要があります。
**OAuth Appのscopeは広めになり得ます。** より細かい権限分離が必要なら、後続でGitHub AppのInstallation Token方式へ移行してください。

## 4. 管理画面にWorker URLを設定
`tahi-mirusen.github.io-main/admin/config.js` を開き、次のURLを実際のWorker URLに変更:
`window.ADMIN_API_URL = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev";`
GitHubへcommit/pushします。

## 5. 動作確認
1. `https://tahi-mirusen.github.io/admin/` を開く。
2. GitHubでログイン。
3. `ALLOWED_GITHUB_LOGINS` に設定したアカウントだけがログインできることを確認。
4. コンテンツ管理でJSONを編集し、GitHubへ保存。
5. GitHub Pagesの反映後、トップページに変更が出ることを確認。
6. アクセス解析はトップページに設定済みのWorker endpointへイベント送信します。

## 現在の機能と制限
- GitHub OAuthログイン、許可ログイン名による管理者判定
- 8時間のサーバー側セッション（ブラウザーには不透明な一時セッショントークン）
- `site-data.json` の読み書き
- 作品・記事の雛形追加、JSON直接編集
- JSONバックアップと復元
- Cookieや個人識別子を使わない日別PV集計（KVの集計値）
- スマホ対応の管理画面
- 解析はページビューの簡易集計。ユニーク訪問者・参照元・端末情報は収集しない
- 画像アップロードUI、画像削除、操作監査ログ、記事の個別URL、公開予約はまだ実装していない

## セキュリティ上の追加推奨
- OAuth Appはこのサイト専用に作り、Client Secretを漏らさない。
- 管理者ログイン名を必要最小限にする。
- Cloudflare WorkerのログにOAuth tokenを出力しない。
- GitHub OAuth Appの権限は定期的に確認し、不要なら認可を取り消す。
- 公開リポジトリなので、秘密情報や非公開原稿を `site-data.json` に入れない。
- 管理画面のセッションはsessionStorageに保持され、ブラウザーを閉じると通常消える。XSS対策を継続する。
