import R from 'ramda';
import rndm from 'rndm';
import deepmerge from 'deepmerge';

import { string, number, Collection, Model } from './types';

const FIELD_PROP = 'FIELD_PROP';
const AGGRAGATION_PROP = 'AGGRAGATION_PROP';
const RELATION_PATH = 'RELATION_PATH';

class Builder {

  constructor(tables) {
    this._tableMap = tables.reduce((sofar, curr) => R.merge(sofar, { [curr._schema._schemaName]: curr }), {});
  }

  parseObj(query, row) {
    const parsed = this.parseExpression(query.expression);
    const context = this.createContext(parsed);
    const availablePropPaths = R.compose(
      R.map(R.prop('path')),
      R.filter(p => p.type == AGGRAGATION_PROP || p.type == FIELD_PROP)
    )(parsed.paths);

    return R.transduce(
      R.map(pair => this.constructObj(context, pair)),
      deepmerge,
      {},
      R.toPairs(R.pick(availablePropPaths, row))
    );
  }

  constructObj(context, [path, value]) {
    const fragments = path.split('.');

    const constructTwo = (frags) => {
      const [parent, child, ...rest] = frags;

      const parentSchema = context.mapping[parent].table._schema;
      const childSchemaProp = parentSchema._props[child];
      const propType = childSchemaProp && childSchemaProp.type;

      if (propType instanceof Collection || propType instanceof Model) {
        const schemaPair = this.schemaPair([parent, child]);
        return { [child]: [constructTwo([schemaPair[1], ...rest])] };
      } else {
        const pathObj = R.find(R.propEq('path', DOT(parent, child)), context.parsedExp.paths);
        const pathObjType = pathObj && pathObj.type;

        if (pathObjType == AGGRAGATION_PROP || propType == number) {
          return { [child]: +value };
        }
        return { [child]: value };
      }

    };

    return constructTwo(fragments);
  }

  build(query) {
    const { expression, filters, orderBy, groupBy, distinct } = query;

    const parsed = this.parseExpression(expression);
    const context = this.createContext(parsed);

    const props = this.findProps(parsed);
    const joins = this.findJoins(parsed);
    const aggregationProps = this.findAggragationProps(parsed);

    const sql = this.concatSnippets(
      this.buildSelect(context, distinct, R.concat(props, aggregationProps)),
      this.buildFrom(context, joins.map(R.prop('path'))),
      this.buildFilters(context, filters),
      this.buildGroupBy(context, groupBy),
      this.buildOrderBy(context, orderBy)
    );

    return { context, sql };
  }

  buildGroupBy(context, groupBy = []) {
    if (!groupBy.length) return '';

    const transducer = R.map(field => {
      const { alias, fieldName } = this.getPropPathRelated(context, field);
      return DOT(alias, fieldName);
    });
    return GROUP_BY(R.transduce(transducer, R.concat, [], groupBy));
  }

  buildOrderBy(context, orderBy = { fields: [] }) {
    if (!orderBy.fields.length) return '';

    const transducer = R.map(field => {
      const { alias, fieldName } = this.getPropPathRelated(context, field);
      return DOT(alias, fieldName);
    });
    return ORDER_BY(R.transduce(transducer, R.concat, [], orderBy.fields), orderBy.descending);
  }

  buildFilters(context, filters = []) {
    return filters.reduce((sofar, filter) => {
      const { field, value, method } = filter;
      const { alias, fieldName, propName, schema } = this.getPropPathRelated(context, field);

      const matchedProp = schema._props[propName];
      const operator = this.getOperator(method || 'eq');

      if (!matchedProp) return [];

      return sofar.concat([
        WHERE_OR_AND(!!sofar.length,
          DOT(alias, fieldName),
          operator,
          this.formatValue(matchedProp, operator, value)
        )
      ]);
    }, []).join(' ');
  }

  buildFrom(context, joinPaths) {
    if (joinPaths.length == 0) {
      const schemaNames = R.keys(context.mapping);
      let { tableName, alias } = context.mapping[schemaNames[0]];
      return FROM(tableName, alias);
    } else {
      return this.buildFromAndJoins(context, joinPaths);
    }
  }

  buildFromAndJoins(context, joinPaths) {
    const ret = joinPaths
      .map(this.parseJoinPathToJoinPairs.bind(this));

    const joins = R.uniq(flatten1(ret)).map(pair => this.tableJoin(context, pair));

    const rootJoin = joins[0];
    return this.concatSnippets(
      FROM(rootJoin.from.tableName, rootJoin.from.alias),
      joins.map(this.buildJoin).join(' ')
    );
  }

  buildJoin(join) {
    return LEFT_JOIN_ON(join.to.tableName, join.to.alias, join.on.from, join.on.to);
  }

  buildSelect(context, distinct, props) {
    const propStrs = props.map(p => this.buildSelectPropPath(context, p)).join(', ');
    return distinct ?
      SELECT(DISTINCT(propStrs)) :
      SELECT(propStrs);
  }

  buildSelectPropPath(context, propPathObj) {
    const { path, type, pathValue } = propPathObj;
    const { normalizedPath, fieldName, alias } = this.getPropPathRelated(context, path);

    if (type == FIELD_PROP) {
      return AS(DOT(alias, fieldName), normalizedPath);
    } else if (type == AGGRAGATION_PROP) {
      const { aggregation, field } = pathValue;
      const aggregationFieldName = field ?
        this.getPropPathRelated(context, field).propName :
        STAR;
      return AS(this.buildAggregationProp(aggregation, DOT(alias, aggregationFieldName)), normalizedPath);
    }
  }

  buildAggregationProp(method, field) {
    return AGGRAGATION_METHODS[method](field);
  }

  getPropPathRelated(context, propPath) {
    const normalized = this.normalizeFetchPath(context.parsedExp.paths, propPath);
    const schemaName = this.getSchemaNameFromPropPath(normalized);

    const { alias, table } = context.mapping[schemaName];
    const { fieldName, propName } = this.getPropNameFromPropPath(table, propPath);

    return { normalizedPath: normalized, schema: table._schema, table, alias, fieldName, propName };
  }

  getSchemaNameFromPropPath(propPath) {
    const joinPath = propPath.substring(0, propPath.lastIndexOf('.'));
    if (this.countLevel(joinPath) == 1) return joinPath;
    return R.last(R.flatten(this.parseJoinPathToJoinPairs(joinPath).map(this.schemaPair.bind(this))));
  }

  getPropNameFromPropPath(table, propPath) {
    const propName = propPath.substring(propPath.lastIndexOf('.') + 1);
    const column = table.columns[propName];
    return { propName, fieldName: column && column.field };
  }

  getOperator(method) {
    const operators = {
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
      eq: '=',
      like: 'LIKE'
    };

    return operators[method];
  }

  formatValue(prop, operator, value) {
    if (prop.type == string) {
      const formatted = `${(value + '').replace(/\"/g, '\\"')}`;
      return operator == 'LIKE' ? `'%${formatted}%'`: `'${formatted}'`;
    } else if (prop.type == number) {
      return value;
    }
  }

  countLevel(path) {
    return path.split('.').length;
  }

  normalizeFetchPath(allPathes, path) {
    const splitted = path.split('.');
    return splitted.reduce((sofar, snippet) => {
      const replacedPath = R.find(R.propEq('alias', snippet), allPathes);
      if (replacedPath) {
        return replacedPath.path;
      } else if (sofar) {
        return `${sofar}.${snippet}`;
      } else {
        return snippet;
      }
    }, '');
  }

  createContext(parsed) {
    const paths = parsed.paths.map(R.prop('path'));
    const root = paths[0];

    const schemaPairsForPathes = this.findJoins(parsed)
      .map(R.prop('path'))
      .map(this.parseJoinPathToJoinPairs.bind(this))
      .map(joinPairsForPath => joinPairsForPath.map(this.schemaPair.bind(this)));

    const allWantedSchemas = R.union([root], R.uniq(R.flatten(schemaPairsForPathes)));

    return {
      parsedExp: parsed,
      mapping: allWantedSchemas.reduce((sofar, curr) => {
        const table = this._tableMap[curr];
        return R.merge(sofar, {
          [curr]: {
            table,
            tableName: table._tableName,
            alias: alias(table._tableName)
          }
        });
      }, {})
    };
  }

  schemaPair(expressionPair) {
    const _this = this;
    const [prevPath, curr] = expressionPair;
    return [prevPath, _this._tableMap[prevPath]._schema._props[curr].type._schemaName];
  }

  tableName(s) {
    return this._tableMap[s]._tableName;
  }

  tableJoin(context, joinPair) {
    const sPair = this.schemaPair(joinPair);
    const [fromCtx, toCtx] = sPair.map(s => context.mapping[s]);

    const [,toExpression] = joinPair;
    const [fromOnField, toOnField] = fromCtx.table.columns[toExpression].field;

    const pick = R.pick(['tableName', 'alias']);

    return {
      from: pick(fromCtx),
      to: pick(toCtx),
      on: {
        from: fromOnField.replace(fromCtx.tableName, fromCtx.alias),
        to: toOnField.replace(toCtx.tableName, toCtx.alias)
      }
    };
  }

  parseJoinPathToJoinPairs(path) {
    const snippets = path.split('.');
    return snippets.reduce((sofar, curr, idx) => {
      if (idx == 0) {
        sofar.lastSchema = curr;
      } else {
        let pair = [sofar.lastSchema, curr];
        sofar.pairs.push(pair);
        sofar.lastSchema = this.schemaPair(pair)[1];
      }
      return sofar;
    }, { lastSchema: '', pairs: [] })
    .pairs;
  }

  findJoins(parsedExpression) {
    return parsedExpression.paths.filter(pathObj => {
      return this.countLevel(pathObj.path) > 1 && R.propEq('type', RELATION_PATH, pathObj);
    });
  }

  findProps(parsedExpression) {
    return parsedExpression.paths.filter(R.propEq('type', FIELD_PROP));
  }

  findAggragationProps(parsedExpression) {
    return parsedExpression.paths.filter(R.propEq('type', AGGRAGATION_PROP));
  }

  getTypeOfPathValue(propValue) {
    if (propValue === true || propValue == 'true') {
      return FIELD_PROP;
    } else if (propValue.aggregation) {
      return AGGRAGATION_PROP;
    } else if (propValue instanceof Object){
      return RELATION_PATH;
    }
  }

  parseExpression(expression, parent = { path: '' } ) {

    const _this = this;
    const createPath = (parentPath, propName, propValue, alias = '') => {
      const type = this.getTypeOfPathValue(propValue);
      return {
        pathValue: propValue,
        path: formatPath(`${parentPath}.${propName}`),
        alias,
        type
      };
    };

    const formatPath = str => str.replace(/^\./g, '');

    return R.toPairs(expression).reduce((sofar, [propName, propValue]) => {
      const [pName, alias] = propName.split(' ');

      const currPath = createPath(parent.path, pName, propValue, alias);
      sofar.paths = R.concat(sofar.paths, [currPath]);

      if (currPath.type == RELATION_PATH) {
        const parsed = _this.parseExpression(propValue, currPath);
        sofar.paths = R.concat(sofar.paths, parsed.paths);
      }

      return sofar;
    }, { paths: [] });

  }

  concatSnippets(...snippets) {
    return snippets
      .filter(R.compose(R.not, R.isEmpty))
      .join(' ')
      .trim();
  }

}

const SELECT = (...props) => `SELECT ${props.join(', ')}`;
const DISTINCT = (...props) => `DISTINCT ${props.join(', ')}`;
const AS = (field, alias) => `${field} AS "${alias}"`;
const FROM = (tableName, alias) => `FROM ${tableName} ${alias}`;
const WHERE_OR_AND = (isAnd, field, method, value) => `${ isAnd ? 'AND' : 'WHERE'} ${field} ${method} ${value}`;
const LEFT_JOIN_ON = (toTableName, toTableAlias, fField, tField) => `LEFT JOIN ${toTableName} ${toTableAlias} ON ${fField} = ${tField}`;
const GROUP_BY = fields => `GROUP BY ${fields.join(', ')}`;
const ORDER_BY = (fields, isDescending) => `ORDER BY ${fields.join(', ')} ${ isDescending ? 'DESC' : 'ASC' }`;
const DOT = (A, B) => `${A}.${B}`;
const STAR = '*';
const AGGRAGATION_METHODS = ['COUNT', 'MAX', 'MIN', 'AVG', 'SUM']
  .reduce((methods, name) => {
    return R.merge(methods, {
      [name.toLowerCase()]: (field) => `${name}(${field})`
    });
  }, {});

const alias = tableName => {
  return `${tableName}_${rndm(2)}`;
};

const flatten1 = arr => {
  var ret = [];
  arr.forEach(item => {
    if (Array.isArray(item)) {
      ret = ret.concat(item);
    } else {
      ret.push(item);
    }
  });

  return ret;
};

export default function(tables) {
  return new Builder(tables);
}