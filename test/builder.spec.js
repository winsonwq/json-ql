import R from 'ramda';
import Builder from '../lib/builder';
import Schema from '../lib/schema';

describe('builder', () => {

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
    .prop('readCount', Schema.Types.number)
    .prop('createdAt', Schema.Types.date)
    .prop('author', Schema.Types.model('author'))
    .prop('comments', Schema.Types.collection('comment'))
    .prop('readers', Schema.Types.collection('reader'))
    .table('articles', prop => {
      if (prop == 'comments') return ['articles.id', 'comments.article_id'];
      if (prop == 'readers') return ['articles.id', 'readers.article_id'];
      if (prop == 'author') return ['articles.author_id', 'authors.id'];
      return prop;
    });

  const commentsMappingTable = Schema.of('comment')
    .prop('comment_title')
    .table('comments');

  const readersMappingTable = Schema.of('reader')
    .prop('name')
    .table('readers');

  describe('#parseExpression', () => {

    var builder, expression;

    before(() => {
      builder = Builder.of([authorMappingTable, articleMappingTable]);
      expression = {
        author: {
          name: true,
          articles: {
            title: true
          }
        }
      };
    });

    it('could parse query expression to get paths', () => {
      const parsed = builder.parseExpression(expression);
      parsed.paths.map(R.prop('path')).should.eql([
        'author',
        'author.name',
        'author.articles',
        'author.articles.title'
      ]);
    });

    it('could parse query expression to get joined paths', () => {
      const parsed = builder.parseExpression(expression);
      builder.findJoins(parsed).map(R.prop('path')).should.eql([
        'author.articles'
      ]);
    });

    it('could parse query expression with alias', () => {
      const expWithAlias = {
        author: {
          name: true,
          'articles A': {
            title: true
          }
        }
      };
      const parsed = builder.parseExpression(expWithAlias);
      parsed.paths.map(R.prop('path')).should.eql([
        'author',
        'author.name',
        'author.articles',
        'author.articles.title'
      ]);
    });

  });

  describe('#parseJoinPathToJoinPairs', function() {

    it('could parse path to pairs', function() {
      const builder = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable]);
      const parsed = builder.parseJoinPathToJoinPairs('author.articles.comments');

      parsed.should.eql([['author', 'articles'], ['article', 'comments']]);
    });

  });

  describe('#join', function() {

    it('could build join', function() {
      const builder = Builder.of([authorMappingTable, articleMappingTable]);
      const context = {
        mapping: {
          author: {
            table: authorMappingTable,
            tableName: authorMappingTable._tableName,
            alias: 'authors_xx'
          },
          article: {
            table: articleMappingTable,
            tableName: articleMappingTable._tableName,
            alias: 'articles_xx'
          }
        }
      };

      builder.tableJoin(context, ['author', 'articles'])
        .should.eql({
          from: {
            tableName: 'authors',
            alias: 'authors_xx'
          },
          to: {
            tableName: 'articles',
            alias: 'articles_xx'
          },
          on: {
            from: 'authors_xx.id',
            to: 'articles_xx.author_id'
          }
        });

    });

  });


  it('could build a basic sql according to one specific schema', () => {
    const query = {
      expression: {
        customer: {
          name: true
        }
      }
    };

    const mappingTable = Schema.of('customer').prop('name').table('customers', R.of);
    const sqlObj = Builder.of([mappingTable]).build(query);
    const alias = sqlObj.context.mapping.customer.alias;
    const target = `SELECT ${alias}.name AS "customer.name" FROM customers ${alias}`;

    sqlObj.sql.should.eql(target);
  });

  describe('join', () => {

    it('could build join when would fetch collection', () => {

      const query = {
        expression: {
          author: {
            name: true,
            articles: {
              title: true,
              comments: {
                comment_title: true
              },
              readers: {
                name: true
              }
            }
          }
        }
      };

      const sqlObj = Builder.of([
        authorMappingTable,
        articleMappingTable,
        commentsMappingTable,
        readersMappingTable
      ]).build(query);

      const context = sqlObj.context.mapping;

      const target = [
        `SELECT`,
        `${context.author.alias}.name AS "author.name", ${context.article.alias}.title AS "author.articles.title", ${context.comment.alias}.comment_title AS "author.articles.comments.comment_title", ${context.reader.alias}.name AS "author.articles.readers.name"`,
        `FROM authors ${context.author.alias}`,
        `LEFT JOIN articles ${context.article.alias} ON ${context.author.alias}.id = ${context.article.alias}.author_id`,
        `LEFT JOIN comments ${context.comment.alias} ON ${context.article.alias}.id = ${context.comment.alias}.article_id`,
        `LEFT JOIN readers ${context.reader.alias} ON ${context.article.alias}.id = ${context.reader.alias}.article_id`
      ].join(' ');

      sqlObj.sql.should.eql(target);

    });

    it('could apply to another case for customer, subscriptions, user', () => {

      const customersTableMapping = Schema.of('customer')
        .prop('name')
        .prop('subscriptions', Schema.Types.collection('subscription'))
        .table('customers', prop => {
          if ('subscriptions' == prop) {
            return ['customers.id', 'subscriptions.customer_id'];
          }
          return prop ;
        });

      const subscriptionsTableMapping = Schema.of('subscription')
        .prop('status')
        .prop('user', Schema.Types.model('user'))
        .table('subscriptions', prop => {
          if (prop == 'user') return ['subscriptions.user_id', 'users.id'];
          return prop;
        });

      const usersTableMapping = Schema.of('user')
        .prop('name')
        .table('users');

      const query = {
        expression: {
          customer: {
            name: true,
            subscriptions: {
              status: true,
              user: {
                name: true
              }
            }
          }
        }
      };

      const sqlObj = Builder.of([customersTableMapping, subscriptionsTableMapping, usersTableMapping])
        .build(query);

      const context = sqlObj.context.mapping;

      const target = [
        `SELECT`,
        `${context.customer.alias}.name AS "customer.name", ${context.subscription.alias}.status AS "customer.subscriptions.status", ${context.user.alias}.name AS "customer.subscriptions.user.name"`,
        `FROM customers ${context.customer.alias}`,
        `LEFT JOIN subscriptions ${context.subscription.alias} ON ${context.customer.alias}.id = ${context.subscription.alias}.customer_id`,
        `LEFT JOIN users ${context.user.alias} ON ${context.subscription.alias}.user_id = ${context.user.alias}.id`
      ].join(' ');

      sqlObj.sql.should.eql(target);
    });

    it('could set relations a alias', () => {

      const query = {
        expression: {
          author: {
            name: true,
            'articles A': {
              title: true,
              'comments C': {
                comment_title: true
              }
            }
          }
        }
      };

      const sqlObj = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable])
        .build(query);

      const context = sqlObj.context.mapping;

      const target = [
        `SELECT`,
        `${context.author.alias}.name AS "author.name", ${context.article.alias}.title AS "author.articles.title", ${context.comment.alias}.comment_title AS "author.articles.comments.comment_title"`,
        `FROM authors ${context.author.alias}`,
        `LEFT JOIN articles ${context.article.alias} ON ${context.author.alias}.id = ${context.article.alias}.author_id`,
        `LEFT JOIN comments ${context.comment.alias} ON ${context.article.alias}.id = ${context.comment.alias}.article_id`
      ].join(' ');

      sqlObj.sql.should.eql(target);

    });

  });

  describe('filter', () => {

    it('could do filter on alias', () => {

      const query = {
        expression: {
          'author Au': {
            name: true,
            'articles A': {
              title: true
            }
          }
        },
        filters: [
          { field: 'A.status', value: 'PUBLISHED' },
          { field: 'Au.A.status', value: 'PUBLISHED' },
          { field: 'Au.status', value: 'ACTIVE' },
          { field: 'Au.articles.status', value: 'ACTIVE' },
          { field: 'author.name', value: 'this is a author name"', operator: 'like' }
        ]
      };

      const sqlObj = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable])
        .build(query);

      const context = sqlObj.context.mapping;

      const target = [
        `SELECT`,
        `${context.author.alias}.name AS "author.name", ${context.article.alias}.title AS "author.articles.title"`,
        `FROM authors ${context.author.alias}`,
        `LEFT JOIN articles ${context.article.alias} ON ${context.author.alias}.id = ${context.article.alias}.author_id`,
        `WHERE`,
        `${context.article.alias}.status = 'PUBLISHED'`,
        `AND ${context.article.alias}.status = 'PUBLISHED'`,
        `AND ${context.author.alias}.status = 'ACTIVE'`,
        `AND ${context.article.alias}.status = 'ACTIVE'`,
        `AND ${context.author.alias}.name LIKE '%this is a author name\\"%'`
      ].join(' ');

      sqlObj.sql.should.eql(target);
    });

  });

  describe('groupBy and orderBy', function() {

    it('could group by and order by on props', () => {
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
        ],
        groupBy: [
          'author.name',
          'A.status'
        ],
        orderBy: {
          fields: [
            'author.name',
            'A.status'
          ],
          descending: true
        }
      };

      const sqlObj = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable])
        .build(query);

      const context = sqlObj.context.mapping;

      const target = [
        `SELECT ${context.author.alias}.name AS "author.name", ${context.article.alias}.status AS "author.articles.status"`,
        `FROM authors ${context.author.alias}`,
        `LEFT JOIN articles ${context.article.alias} ON ${context.author.alias}.id = ${context.article.alias}.author_id`,
        `WHERE ${context.article.alias}.status = 'PUBLISHED'`,
        `GROUP BY ${context.author.alias}.name, ${context.article.alias}.status`,
        `ORDER BY ${context.author.alias}.name, ${context.article.alias}.status DESC`
      ].join(' ');

      sqlObj.sql.should.eql(target);
    });

  });

  describe('aggregation', () => {

    it('could use aggregation function on query expression', () => {

      const query = {
        expression: {
          author: {
            name: true,
            nameCount: { aggregation: 'count' },
            articles: {
              status: true
            }
          }
        },
        groupBy: [
          'author.name',
          'author.articles.status'
        ],
        distinct: true
      };

      const sqlObj = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable])
        .build(query);

      const context = sqlObj.context.mapping;

      const target = [
        `SELECT DISTINCT ${context.author.alias}.name AS "author.name", ${context.article.alias}.status AS "author.articles.status", COUNT(${context.author.alias}.*) AS "author.nameCount"`,
        `FROM authors ${context.author.alias}`,
        `LEFT JOIN articles ${context.article.alias} ON ${context.author.alias}.id = ${context.article.alias}.author_id`,
        `GROUP BY ${context.author.alias}.name, ${context.article.alias}.status`
      ].join(' ');

      sqlObj.sql.should.eql(target);
    });

  });

  describe('between operator', function() {

    it('could add between operator', function() {

      const startDatetime = new Date('2016-01-26').getTime();

      const query = {
        expression: {
          article: {
            readCount: true
          }
        },
        filters: [
          { field: 'article.readCount', value: [10, 20], operator: 'between' },
          { field: 'article.createdAt', value: [startDatetime, '2016-01-26T07:00:13.299Z'], operator: 'between' }
        ]
      };

      const sqlObj = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable])
        .build(query);

      const context = sqlObj.context.mapping;

      const target = [
        `SELECT ${context.article.alias}.readCount AS "article.readCount"`,
        `FROM articles ${context.article.alias} WHERE ${context.article.alias}.readCount BETWEEN 10 AND 20`,
        `AND ${context.article.alias}.createdAt BETWEEN '2016-01-26 00:00:00.000' AND '2016-01-26 07:00:13.299'`
      ].join(' ');

      sqlObj.sql.should.eql(target);

    });

  });

  describe('#parse result', function() {

    it('could parse result to object', function() {
      const query = {
        expression: {
          author: {
            name: true,
            nameCount: { aggregation: 'count' },
            articles: {
              status: true
            }
          }
        },
        groupBy: [
          'author.name',
          'author.articles.status'
        ]
      };

      const builder = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable]);

      const obj = {
        'author.name': '张三',
        'author.articles.status': 'PUBLISHED',
        'author.nameCount': '1'
      };

      const parsed = builder.parseObj(query)(obj);

      parsed.should.eql({ name: '张三', nameCount: 1, articles: [{ status: 'PUBLISHED' }] });
    });

    it('could parse result to object when set model relation', function() {
      const query = {
        expression: {
          article: {
            title: true,
            author: {
              name: true
            }
          }
        }
      };

      const builder = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable]);

      const obj = {
        'article.title': 'article title',
        'article.author.name': 'steven'
      };

      const parsed = builder.parseObj(query)(obj);
      parsed.should.eql({ title: 'article title', author: { name: 'steven' } });
    });

  });

  describe('#beforeConcatinatingFilters', function() {

    it('could add a hook on options', function() {
      const builder = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable])
        .beforeConcatinatingFilters_(filters => filters);

      builder._options.hooks.beforeConcatinatingFilters_.should.be.a.Function();
    });

    it('would add more filters if add more filters before concatinate SQL', function() {
      const query = {
        expression: {
          author: {
            name: true,
            nameCount: { aggregation: 'count' },
            articles: {
              status: true
            }
          }
        },
        groupBy: [
          'author.name',
          'author.articles.status'
        ],
        filters: [
          { field: 'author.name', value: 'my name', operator: 'like' }
        ]
      };

      const builder = Builder.of([authorMappingTable, articleMappingTable, commentsMappingTable]);
      const builder2 = builder.beforeConcatinatingFilters_((filterObjs, context) => {
        const moreFilters = [
          { field: `${context.mapping.author.alias}.schema #> {'property'}`, operator: `?&`, value: `array['item 1']` }
        ];
        return R.concat(filterObjs, moreFilters);
      });

      const sqlObj = builder2.build(query);
      const context = sqlObj.context.mapping;

      const target = [
        `SELECT ${context.author.alias}.name AS "author.name", ${context.article.alias}.status AS "author.articles.status", COUNT(${context.author.alias}.*) AS "author.nameCount"`,
        `FROM authors ${context.author.alias}`,
        `LEFT JOIN articles ${context.article.alias} ON ${context.author.alias}.id = ${context.article.alias}.author_id`,
        `WHERE ${context.author.alias}.name LIKE '%my name%'`,
        `AND ${context.author.alias}.schema #> {'property'} ?& array['item 1']`,
        `GROUP BY ${context.author.alias}.name, ${context.article.alias}.status`
      ].join(' ');

      sqlObj.sql.should.eql(target);

    });

  });

});
