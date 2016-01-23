import 'should';
import Schema from '../lib/schema';

describe('schema', () => {

  describe('schema constructor', () => {

    it('should create schema obj', () => {
      Schema.of('customer')._schemaName.should.eql('customer');
    });

  });

  describe('#prop', () => {

    it('could set prop with default type', () => {
      Schema.of('customer').prop('name')._props['name'].type.should.eql(Schema.Types.string);
    });

    it('could set prop with type', () => {
      Schema.of('customer').prop('age', Schema.Types.number)._props['age'].type.should.eql(Schema.Types.number);
    });

    it('could set prop as Collection', () => {
      Schema.of('customer')
        .prop('subscriptions', Schema.Types.collection('subscription'))
        ._props['subscriptions']
        .type
        .should.eql(Schema.Types.collection('subscription'));
    });

  });

  describe('#table', () => {

    it('could bind a table', () => {
      Schema.of('customer')
        .prop('age')
        .table('customers', prop => `column_${prop}`)
        .columns['age']
        .field
        .should.eql('column_age');
    });

    it('could bind a table with collection', () => {

      Schema.of('author')
        .prop('name')
        .prop('articles', Schema.Types.collection('article'))
        .table('authors', prop => {
          if (prop == 'articles') {
            return ['authors.id', 'articles.author_id'];
          }
          return prop;
        })
        .columns['articles']
        .field
        .should.eql(['authors.id', 'articles.author_id']);

    });

  });

});
