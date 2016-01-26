
export class Collection {
  constructor(schemaName) {
    this._schemaName = schemaName;
  }
}

export const collection = schemaName => {
  return new Collection(schemaName);
};

export class Model {
  constructor(schemaName) {
    this._schemaName = schemaName;
  }
}

export const model = schemaName => {
  return new Model(schemaName);
};

export const number = Number;
export const string = String;
export const date = Date;
