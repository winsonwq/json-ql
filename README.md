# json-ql

> json defined common sql for dynamic query

_version: alpha_

## Installation

Babel is required sofar.

```bash
npm install json-ql
```

## Example

### Schema definition
```js
import { Schema } from 'json-ql';

const authorMappingTable = Schema.of('author')
  .prop('name')
  .prop('address')
  .prop('status')
  .prop('articles', Schema.Types.collection('article'))
  .table('authors', prop => {
    if (prop == 'articles') {
      return ['authors.id', 'articles.author_id'];
    }
    return prop;
  });


const articleMappingTable = Schema.of('article')
  .prop('title')
  .prop('status')
  .prop('comments', Schema.Types.collection('comment'))
  .prop('readers', Schema.Types.collection('reader'))
  .table('articles', prop => {
    if (prop == 'comments') return ['articles.id', 'comments.article_id'];
    if (prop == 'readers') return ['articles.id', 'readers.article_id'];
    return prop;
  });

const commentsMappingTable = Schema.of('comment')
  .prop('commentTitle')
  .table('comments');

const readersMappingTable = Schema.of('reader')
  .prop('name')
  .table('readers');
```

### Create Query
```js

import jsonql from 'json-ql';

const query = {
  expression: {
    author: {
      name: true,
      articles: {
        title: true,
        'comments c': {
          commentTitle: true
        },
        readers: {
          name: true
        }
      }
    }
  },
  filters: [
    { field: 'c.commentTitle', value: 'i like it', operator: 'like' }
  ]
};

const { sql } = jsonql.of([authorMappingTable, articleMappingTable, commentsMappingTable, readersMappingTable]).build(query);
```

### Output

```sql
SELECT
  authors_4k.name AS "author.name",
  articles_0V.title AS "author.articles.title",
  comments_Fk.comment_title AS "author.articles.comments.comment_title",
  readers_XF.name AS "author.articles.readers.name"
FROM authors authors_4k
  LEFT JOIN articles articles_0V ON authors_4k.id = articles_0V.author_id
  LEFT JOIN comments comments_Fk ON articles_0V.id = comments_Fk.article_id
  LEFT JOIN readers readers_XF ON articles_0V.id = readers_XF.article_id
WHERE
  comments_Fk.comment_title LIKE '%i like it%'
```

### ParseObj

The flat fetched data could be parsed into object.

```js
const obj = {
  'author.name': '张三',
  'author.articles.status': 'PUBLISHED',
  'author.nameCount': '1'
};

const parsed = builder.parseObj(query, obj);
// OUTPUT:
// { name: '张三', nameCount: 1, articles: [{ status: 'PUBLISHED' }] }
```

### Define GroupBy and OrderBy

```js
const query = {
  expression: {
    'author Au': {
      name: true,
      'articles A': {
        status: true
      }
    }
  },
  filters: [
    { field: 'A.status', value: 'PUBLISHED' }
    { field: 'A.status', value: 'PUBLISHED', operator: 'gt', or: true }
    // avaliable operators: gt, gte, lt, lte, eq, like, notEq(neq), between
  ],
  groupBy: [
    'author.name',
    'A.status'
  ],
  orderBy: [
    { field: 'author.name', descending: true },
    { field: 'A.status', descending: false }
  ]
};
```

## Contributors

* [lukyw](https://github.com/lukywong)
* [winsonwq](https://github.com/winsonwq)

## TODO

- [ ] where _something_ is NULL
- [x] where _condition_ OR _condition_ expression
- [ ] having expression

# License

> Copyright (c) 2013 - 2016 Wang Qiu (winsonwq@gmail.com)

> Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

> The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
