import R from 'ramda';

export const SELECT = (...props) => `SELECT ${props.join(', ')}`;
export const DISTINCT = (...props) => `DISTINCT ${props.join(', ')}`;
export const AS = (field, alias) => `${field} AS "${alias}"`;
export const FROM = (tableName, alias) => `FROM ${tableName} ${alias}`.trim();
export const WHERE_OR_AND = (first, isOr, field, method, value) => {
  var prefix = first ? 'WHERE' : (isOr ? 'OR' : 'AND');
  return `${prefix} ${field} ${method} ${value}`;
};
export const LEFT_JOIN_ON = (toTableName, toTableAlias, fField, tField) => `LEFT JOIN ${toTableName} ${toTableAlias} ON ${fField} = ${tField}`;
export const GROUP_BY = fields => `GROUP BY ${fields.join(', ')}`;
export const ORDER_BY = (fields) => `ORDER BY ${fields.join(', ')}`;
export const DOT = (A, B) => `${A}.${B}`;
export const STAR = '*';
export const AGGRAGATION_METHODS = ['COUNT', 'MAX', 'MIN', 'AVG', 'SUM']
  .reduce((methods, name) => {
    return R.merge(methods, {
      [name.toLowerCase()]: (field) => `${name}(${field})`
    });
  }, {});

export const DE_A_SC = isDescending => isDescending ? 'DESC' : 'ASC';

export const PAGER = (limit, offset) => {
  return [LIMIT(limit), OFFSET(offset)].join(' ').trim();
};

export const LIMIT = limit => limit ? `LIMIT ${limit}` : '';
export const OFFSET = offset => offset ? `OFFSET ${offset}` : '';

export const parenthesis = str => `(${str})`;

export const SELECT_FROM_WITH_PAGER = (tableName, limit, offset) => {
  const pager = PAGER(limit, offset);
  if (pager) {
    return parenthesis([SELECT('*'), FROM(tableName, ''), pager].join(' ').trim());
  }
  return tableName;
};
