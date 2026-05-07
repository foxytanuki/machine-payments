# MPP Payments と HitPay MPP の比較

このドキュメントは、既存の `mpp` サンプルと同じ階層に `hitpaympp` サンプルを追加する前提で、Stripe ベースの MPP Payments と HitPay MPP の導入方法・テスト環境の違いを整理するものです。

## 結論

両方とも **HTTP `402 Payment Required` を使って有料エンドポイントを保護する MPP 実装** という点では同じです。

ただし、実際の導入手順は同一ではありません。Stripe 版は `mppx` と Stripe の PaymentIntent / SPT / Crypto 設定を使い、HitPay 版は `@hit-pay/mpp` と HitPay の sandbox API key / webhook / broker を使います。

`hitpaympp` サンプルを作る場合は、既存 `mpp` サンプルと同じように「有料エンドポイントを立てて、未払いなら 402、支払い後は 200 + receipt」を確認できるテスト環境にするのが自然です。

## 共通する考え方

どちらも基本フローは同じです。

1. サーバーに MPP 対応 SDK を導入する
2. 有料エンドポイントを middleware / wrapper で保護する
3. 支払い credential がないリクエストには `402 Payment Required` を返す
4. クライアントまたは agent が支払いを行う
5. 支払い credential 付きで同じエンドポイントを再リクエストする
6. サーバーが credential を検証する
7. 成功したら本来のレスポンスと receipt を返す

## 主な違い

| 観点 | MPP Payments | HitPay MPP |
| --- | --- | --- |
| 決済基盤 | Stripe | HitPay |
| サーバー SDK | `mppx` | `@hit-pay/mpp` |
| クライアント / テスト | `mppx` CLI、`link-cli` | `@hit-pay/mpp-client` |
| 支払い方式 | Crypto、SPT | one-time payment、saved payment method |
| サーバー側 API | `Mppx.create(...).charge(...)` | `createMpp(...).protect(...)` |
| 外部サービス | Stripe API | HitPay API + HitPay MPP broker |
| 事前設定 | Stripe account、machine payments、stablecoin / profile 設定など | HitPay sandbox API key、webhook endpoint、webhook salt |
| 本番対応 | live mode / mainnet 手順あり | early preview、sandbox only |

## 導入手順の比較

### MPP Payments

Stripe 版では、支払い方式によって必要な設定が変わります。

#### Crypto

- `mppx/server` の `Mppx` と `tempo.charge` を使う
- Stripe の `PaymentIntent` を `payment_method_types: ['crypto']` で作成する
- PaymentIntent から deposit address を取得する
- その deposit address を MPP challenge の recipient に使う
- client が on-chain payment を行う
- Stripe が settlement を検知して PaymentIntent を capture する

この方式では、deposit address の作成・キャッシュ・検証がサーバー側に必要です。

#### SPT

- `mppx/server` の `stripe.charge` を使う
- client は Link / SPT を使って shared payment token を発行する
- サーバーは credential を受け取り、SDK 経由で PaymentIntent を作成する
- PaymentIntent 作成は `stripe.charge` 側が処理する

Crypto と比べると deposit address 管理は不要ですが、Stripe profile / `networkId` / Link CLI を使った SPT テストが必要です。

### HitPay MPP

HitPay 版では、SDK がより middleware 風に見えます。

- `@hit-pay/mpp` をインストールする
- HitPay sandbox dashboard で API key を取得する
- HitPay sandbox dashboard で webhook endpoint を追加する
- broker endpoint として `https://sandbox.mpp.hitpay.dev` を使う
- `createMpp(...)` で SDK を初期化する
- `mpp.protect(...)` または `mpp.protectSavedMethod(...)` で handler を保護する

one-time payment の場合は、credential がなければ HitPay checkout URL を含む 402 を返し、支払い後に broker が credential / receipt を処理します。

saved payment method の場合は、初回に wallet を保存する setup flow があり、その後は保存済み JWS を使って複数回の支払いを行います。

## テスト環境として揃えるべきもの

既存の `mpp` サンプルと同じ階層に `hitpaympp` を作るなら、最低限以下を揃えると比較しやすくなります。

### サーバー側

- `GET /paid` の有料エンドポイント
- 未払い時に `402` を返すこと
- 支払い成功後に JSON を返すこと
- receipt をレスポンスに付けること
- `.env` で API key / webhook salt / broker endpoint を設定できること

### README

- 何を示すサンプルか
- 必要な HitPay sandbox 設定
- `.env` の例
- インストール手順
- 起動コマンド
- 未払いリクエストの確認コマンド
- 支払い付きリクエストの確認方法

### 環境変数の候補

```bash
HITPAY_API_KEY=test_...
HITPAY_WEBHOOK_SALT=...
HITPAY_MPP_ENDPOINT=https://sandbox.mpp.hitpay.dev
PORT=4242
```

### package 構成の候補

```text
hitpaympp/
  package.json
  tsconfig.json
  .env.example
  README.md
  src/
    server.ts
```

既存 `mpp` サンプルが Node / TypeScript の直接起動サンプルであれば、`hitpaympp` も同じ形にすると比較しやすいです。

## 実装方針の対応表

| 既存 `mpp` サンプルで確認したいこと | `hitpaympp` で対応するもの |
| --- | --- |
| MPP SDK を初期化する | `createMpp(...)` |
| 有料 endpoint を作る | `mpp.protect(...)` |
| 未払い時に 402 を返す | SDK の challenge response |
| 支払い後に endpoint body を返す | protected handler の JSON response |
| receipt を返す | HitPay broker が署名した receipt JWS |
| CLI / client で支払いリクエストする | `@hit-pay/mpp-client` の `mppFetch(...)` |

## 注意点

- HitPay MPP は early preview で、現時点では sandbox only とされている
- Production rails はまだ open soon 扱い
- Express / Fastify adapter は後続予定なので、まずは fetch-style handler / Next.js App Router 互換の形が前提
- webhook 設定が必要なので、ローカルテストでは公開 URL または tunnel が必要になる可能性がある
- `@hit-pay/mpp-client` を使った支払いテスト手順は、既存 `mppx` CLI のテスト手順とは別に書く必要がある

## まとめ

`hitpaympp` サンプルは、既存 `mpp` サンプルと同じ階層に置いて問題ありません。

ただし、実装は単純なコピーではなく、Stripe / `mppx` 固有部分を HitPay / `@hit-pay/mpp` 固有部分に置き換える形になります。

比較しやすいサンプルにするなら、まずは one-time payment の `GET /paid` を作り、既存サンプルと同じ観点で以下を確認できるようにするのがよさそうです。

- 未払いリクエストで `402` が返る
- challenge に HitPay checkout URL が含まれる
- 支払い後に credential 付きで再リクエストできる
- 成功時に `200` と JSON body が返る
- receipt JWS が返る
