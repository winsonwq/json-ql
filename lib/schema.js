import R from 'ramda';
import Table from './table';

import {
  collection,
  model,
  number,
  string,
  date
} from './types';

export default class Schema {

  static Types = {
    collection,
    model,
    number,
    string,
    date
  };

  static of = (schemaName, props = {}) => {
    return new Schema(schemaName, props);
  };

  constructor(schemaName, props) {
    this._schemaName = schemaName;
    this._props = props;
  }

  prop(propName, type = string, info) {
    return Schema.of(
      this._schemaName,
      R.merge(this._props, {
        [propName]: { type, info }
      })
    );
  }

  table(tableName, propXform = R.of) {
    const columns = R.fromPairs(
      R.toPairs(this._props)
        .map(([propName, val]) => [propName, R.merge(val, { field: propXform(propName) })])
        .filter(([propName, val]) => propName && val.field)
      );

    return Table(tableName, this, columns);
  }

}
