---
title: "Pinecone の使い方を LangChain と絡めて整理してみた"
emoji: "🌲"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["Pinecone", "vectordb", "langchain"]
published: false
---

皆さんは OpenAI の GPT シリーズを使ってアプリ開発をしていますか？そんなみなさんなら、一度は LangChain を使い、そしてベクトルストレージ・ベクトルデータベースの対象として [Pinecone](pinecone.io) を使われている方も多いんじゃないかと思います。

私はベクトルデータベースを使うのが初めてで、そもそも「Embeddingって何？インデックス？ベクトル？」というレベルでした。
LangChain を使っていると、いい感じに裏でやってくれているので Pinecone をどのように扱っているか、データの操作はどうすればいいのか、といった疑問も出てくるのではないでしょうか。

ここ数ヶ月 LangChain 周りで遊ぶ傍ら、Pinecone についても触れる機会が多くなったのでアウトプットして整理してみようと思います。

## 書かないこと

ベクトル、インデックス、Embedding などの用語説明や、Pinecone の管理コンソール で Index を作成したりAPIキーを取得したりするところはもう日本語で記事も見かけるので、そちらに譲ります。

## 前提

Typescript を使っています。Python のほうがドキュメントやクライアントライブラリも充実しているので、どちらも使える方は Python のほうが良いかもしれません。


:::message
2023年5月現在、[TS版のクライアントライブラリ]()は Public beta です。サポートは受け付けておらず、破壊的な変更も行われる可能性があるので、利用には十分注意してください。
:::


## 基本の使い方

```typescript
import { PineconeClient } from '@pinecone-database/pinecone

const pinecone = new PineconeClient()

async function () => {
	await pinecone.init({
		apiKey: 'YOUR_API_KEY',
		environment: 'YOUR_ENVIRONMENT', 
	})

	const index = pinecone.Index('YOUR_INDEX')

	// 新しいベクトルを保存
	const upsertRequest = {
		vectors: [
			{
				id: 'hoge_id_001',
				values: [0, 1, 2, 3, 4, 5],
				metadata: {
					author: 'killinsun',
					title: 'my first vector'
				}
			},
			{
				id: 'hoge_id_002',
				values: [10, 11, 12, 13, 14, 55],
				metadata: {
					author: 'killinsun',
					title: 'my second vector'
				}
			},
		]
	}
	const upsertResponse = await index.upsert({ upsertRequest })
	console.log(upsertResponse)
	// { upsertedCount: 1 }

	// ベクトルでクエリ
	const queryByVector = {
		vector: [0, 1, 2, 3, 4, 5],
		topK: 1,
		includeMetadata: true,
		includeValues: true
	}
	const queryVectorResponse = await index.query({ queryByVector })
	console.log(queryVectorResponse)
	// 	{
	//   id: 'hoge_id_001',
	//   score: 1.0,
	//   values: [0, 1, 2, 3, 4, 5],
	//   sparseValues: undefined,
	//   metadata: { author: 'killinsun', title: 'my first vector' }
	// }

	// ID でクエリ
	const queryById = {
		id: 'hoge_id_002'
		topK: 1,
		includeMetadata: true,
		includeValues: true
	}
	const queryIdResponse = await index.query({ queryById })
	console.log(queryIdResponse)
	// 	{
	//   id: 'hoge_id_002',
	//   score: 1.0,
	//   values: [10, 11, 12, 13, 14, 15],
	//   sparseValues: undefined,
	//   metadata: { author: 'killinsun', title: 'my second vector' }
	// }
}


```

### initialize

index, environment はややこしいですが、`hogehoge-fd66e9e.svc.us-west5-gcp-free.pinecone.io` なら `hogehoge` が Index、 `us-west5-gcp-free` が environment になります。

### Upsert

- 用意した Index にベクトルを保存するには `upsert` メソッドを使います。Upsert なので、 `id` がすでに存在していれば上書きです。
- `vectors[].values` にはベクトル化した値を入れます。たとえば OpenAI の `text-embedding-ada-002` や、`Cohere` などを使って、文章や画像、その他のリソースを数値の配列に変換したものです。
- `metadata` には任意の値を定義できます。上記の例では著者やタイトルをメタデータとして保存しています。LangChain では `metadata` を使って、`metadata.source` にURLなどを登録したりしています

### Query

- 保存したベクトルを検索するには、 `query` メソッドを使います。クエリに含めて`vector`に最も近いものから順に結果が返ってきます。それぞれの結果に `score` という値がついており、高ければ高いほど、クエリに含めたベクトルに対してその結果が近いことを示しています。
- 注意点として、クエリには `vector` か `id` のどちらかを使って検索ができますが、どちらか片方を指定しないと下記エラーで怒られてしまいます。

```bash
[PineconeError: PineconeClient: Error calling query: PineconeError: No query provided]
```

- `topK` は検索結果を何件絞り込むか指定できます。クエリはあくまで「どれだけ似ているか」で順番にベクトルを返しているだけなので、`topK`の値を大きくすることで、クエリに関係のない結果を含めて全件取得できます。ただし、Pinecone側の制限により、上限は`10,000`件までです。
	- また、 パフォーマンスに影響が出るため、`1,000`件以上の場合は `includeMetadata`, `includeValues`をオプションに加えてもPinecone側から返ってこないので注意してください。


## LangChain と絡めて使ってみる

### LangChain 経由で登録した全ベクトルIDを取得したい

可能な限りとれる方法を模索しました。可能な限り、というのは Pinecone の仕様上、全 ID を出力することができないからです。

参考：[How to retrieve list of IDs in an index](https://community.pinecone.io/t/how-to-retrieve-list-of-ids-in-an-index/380)

ただしベクトルの件数が 10,000件以下の場合は下記方法で取得できます。

#### 全ベクトルを引っ張る(Index 内の総ベクトル数が少ない場合のみ有効)


```typescript
const query = {
	vector: Array(1536).fill(0),
	topK: 10000,
}
const response = await index.query({ query })
if(!response.matches) return
console.log(response.matches.map((v) => v.id))
// [ 'hoge_id_001', 'hoge_id_002', ,,,,]
```

#### metadata を活用する

たとえば `metadata.source` に URL を格納していた場合、これを使って絞り込みができます。そうすれば、 `https://example.com` に関する全ベクトルを引っ張ることができます。

Webページをスクレイピングした結果をベクトルに保存している場合、ページ単位であれば、チャンクに区切る粒度にもよりますが有効な手段といえます。

```typescript
// https://example.com に関するベクトルを 1,000件、メタデータと値付きで取得
const query = {
	vector: Array(1536).fill(0),
	filter: { source: { "$eq": "https://example.com" } },
	topK: 1000,
	includeMetadata: true,
	includeValues: true
}
```

実際にはメタデータもvaluesも含めず取得し、`id`のみ取り出してから`upsert()`でページまるごと新しくベクトルに保存しなおす、という使い方になると思います。

その他にもフィルタリング条件の種類はいくつかあるので、ドキュメントを参考にしてみてください。
[Metadata filtering](https://docs.pinecone.io/docs/metadata-filtering)

##### 注意点

metadata 自体は便利ですが、 [ベクトルあたり 40KB の制限](https://docs.pinecone.io/docs/limits)があります。
また、大きなインデックスのすべてのベクトルに対して一意な値など、カーディナリティの高い metadata は、予想以上にメモリを使用してしまい、Pinecone 側の上限にひっかかるおそれがあります

#### Namespace

`namespace` という `metadata` よりも大きな括りでIndex内のベクトルを区切って管理することができます。
なんとなくの使い方は理解しているんですが、記事に書けるほど模索しきれていないので、今回は割愛します。

[Using namespaces](https://docs.pinecone.io/docs/namespaces)


### LangChain では Pinecone にベクトルのIDをどのように登録しているのか？

実際、Pinecone を使う際は `vector` での検索はもちろん、なんらかのユニークな `ID` で作業をしたいことも多いかと思います。ただ、LangChain を用いてベクトルを保存した場合、そのままでは以下のように、`Document` から `uuidv4` を用いてユニークなキーを生成して登録しています。

```typescript
// LangChain.js のソースより
const documentIds = ids == null ? documents.map(() => uuidv4()) : ids;
```

そのため、LangChain の提供する各種 Splitter の区切りによってはこのIDが変わるため、IDを推測するのが難しい挙動になっています。

個人的にはドキュメントを split して chunk に区切る際、手元でも同じuuid を生成しておいてそれらを別のストレージに保存しておくとかが手頃な回避策かなと思います。


## やってみて

LangChain 経由で知ったサービスですが、当初イメージしていたよりもずっととっつきやすく、すぐに使えました。

マネージド・サービスな上、スケーリングもできるのが素晴らしいですね。

ただ、互換となるサードパーティや、手元で動かすための手段がないため、開発する際もPineconeにアクセスできる環境でないといけないところは、製品として選定する上ではネックになるかもしれません。

また、LangChain.js 現在の仕様だと、ほとんどの人が「ベクトル化して保存しっぱなし」状態のまま、メンテナンスが難しい状況にハマってるんじゃないかなと想像します。この記事を参考に、すでに保存してしまったベクトルデータをどう扱っていくのかの一助となれば幸いです。

/以上




