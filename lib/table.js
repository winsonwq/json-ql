class Table {

  constructor(tableName, schema, columns) {
    this._tableName = tableName;
    this.columns = columns;
    this._schema = schema;
  }

}

export default function of(tableName, schema, columns = {}) {
  return new Table(tableName, schema, columns);
}
