
export class Collection {
  constructor(schemaName) {
    this._schemaName = schemaName;
  }
}

export class Computed {
  constructor(resolver) {
    this._resolver = resolver || function() {};
  }
}

export class Model {
  constructor(schemaName) {
    this._schemaName = schemaName;
  }
}

export const collection = schemaName => new Collection(schemaName);
export const computed = resolver => new Computed(resolver);
export const model = schemaName => new Model(schemaName);

export const number = Number;
export const string = String;
export const date = Date;
