import R from 'ramda';
import deepmerge from 'deepmerge';

import escape, { dateParse } from './escape';

import { date, string, number, Collection, Model, Computed } from './types';

import {
  SELECT,
  DISTINCT,
  AS,
  FROM,
  WHERE_OR_AND,
  LEFT_JOIN_ON,
  GROUP_BY,
  ORDER_BY,
  DOT,
  STAR,
  AGGRAGATION_METHODS,
  PAGER,
  DE_A_SC,
  ALIAS
} from './sql-fragments';

const FIELD_PROP = 'FIELD_PROP';
const FILTER_PROP = 'FILTER_PROP';
const AGGRAGATION_PROP = 'AGGRAGATION_PROP';
const RELATION_PATH = 'RELATION_PATH';

export default class Builder {

  static of = (tables, options = {}) => {
    return new Builder(tables, options);
  };

  constructor(tables, options = {}) {
    this._tables = tables;
    this._tableMap = tables.reduce((sofar, curr) => R.merge(sofar, { [curr._schema._schemaName]: curr }), {});
    this._options = options;
  }

  build(query) {
    if (!query.pager) {
      return this.buildNormal(query);
    } else {
      return this.buildWithPager(query);
    }
  }

  buildNormal(query) {
    const { filters, orderBy, groupBy, distinct } = query;
    const context = this.createContext(this.parseQuery(query));

    const props = this.findProps(context.parsedExp);
    const aggregationProps = this.findAggragationProps(context.parsedExp);

    const sql = this.concatSnippets(
      this.buildSelect(context, distinct, R.concat(props, aggregationProps)),
      this.buildFrom(context, this.getAllJoinPaths(context.parsedExp.paths, context.parsedFilters)),
      this.buildFilters(context, filters),
      this.buildGroupBy(context, groupBy),
      this.buildOrderBy(context, orderBy)
    );

    return { context, sql };
  }

  buildWithPager(query) {
    const { filters, orderBy, groupBy, distinct, pager } = query;
    const { limit, pageIdx } = pager || {};

    const context = this.createContext(this.parseQuery(query));

    const props = this.findProps(context.parsedExp);
    const aggregationProps = this.findAggragationProps(context.parsedExp);
    const rootRelated = this.getRootRelatedQuery(context, filters, orderBy);

    const sql = this.concatSnippets(
      this.buildSelect(context, distinct, R.concat(props, aggregationProps)),
      this.buildRootFrom(context, rootRelated, limit, pageIdx),
      this.buildJoins(context, this.getAllJoinPaths(context.parsedExp.paths, context.parsedFilters)),
      this.buildFilters(context, this.getJoinRelatedArray(context, rootRelated.rootSchema, filters)),
      this.buildGroupBy(context, groupBy),
      this.buildOrderBy(context, orderBy)
    );

    return { context, sql };
  }

  getRootRelatedQuery(context, filters = [], orderBy = []) {
    const { parsedExp } = context;
    const rootSchema = parsedExp.paths[0].path;
    return {
      rootSchema,
      rootRelatedFilters: this.getRootRelatedArray(context, rootSchema, filters),
      rootRelatedOrderBys: this.getRootRelatedArray(context, rootSchema, orderBy)
    };
  }

  getRelatedArray(context, predicate, arr = []) {
    return arr.filter(f => {
      const related = this.getPropPathRelated(context, f.field);
      return predicate(related);
    });
  }

  getRootRelatedArray(context, rootSchema, arr) {
    return this.getRelatedArray(context, ({ schema }) => schema._schemaName == rootSchema, arr);
  }

  getJoinRelatedArray(context, rootSchema, arr) {
    return this.getRelatedArray(context, ({ schema }) => schema._schemaName != rootSchema, arr);
  }

  beforeConcatinatingFilters_(filtersXform) {
    const options = { hooks: { beforeConcatinatingFilters_: filtersXform } };
    return Builder.of(this._tables, deepmerge(this._options, options));
  }

  parseObj = R.curry((query, row) => {
    const context = this.createContext(this.parseQuery(query));
    const paths = context.parsedExp.paths;

    const availablePropPaths = R.filter(p => p.type == AGGRAGATION_PROP || (p.type == FIELD_PROP && valueTrue(p.pathValue)), paths);
    const computedPropPaths = R.filter(p => p.related.type instanceof Computed, paths);

    const structured = R.transduce(
      R.map(pair => this.constructObj(context, pair)),
      deepmerge,
      {},
      R.toPairs(R.pickAll(availablePropPaths.map(R.prop('path')), row))
    );

    const result = computedPropPaths.reduce((sofar, pathObj) => {
      const resolver = pathObj.related.type._resolver;
      const prefixValue = R.path(this.getPrefix(pathObj.path).split('.').slice(1), sofar);
      return deepmerge(sofar, this.constructObj(context, [pathObj.path, resolver(prefixValue)]));
    }, structured);

    return result;
  });

  mergeParsedObjs(parsedObjs) {
    const _this = this;
    const isArray = val => Array.isArray(val);

    const getProps = item => R.pickBy(R.compose(R.not, isArray), item);
    const getArrays = item => R.pickBy(isArray, item);

    const grouped = parsedObjs
      .map(item => ({ key: getProps(item), value: item }))
      .reduce(function(sofar, curr) {
        const target = R.find(R.propEq('key', curr.key), sofar);
        if (target) {
          R.keys(getArrays(target.value)).forEach(key => {
            target.value[key] = target.value[key].concat(curr.value[key]);
          }, {});

          return sofar;
        } else {
          return [...sofar, curr];
        }
      }, [])
      .map(R.prop('value'));

    grouped.forEach(function(item) {
      R.keys(getArrays(item)).forEach(function(key) {
        item[key] = _this.mergeParsedObjs(item[key]);
      });
    });

    return grouped;
  }

  constructObj(context, [path, value]) {
    const fragments = path.split('.');

    const constructTwo = (frags) => {
      const [parent, child, ...rest] = frags;

      const parentSchema = context.mapping[parent].table._schema;
      const childSchemaProp = parentSchema._props[child];
      const propType = childSchemaProp && childSchemaProp.type;
      const schemaPair = this.schemaPair([parent, child]);

      if (propType instanceof Collection) {
        return { [child]: [constructTwo([schemaPair[1], ...rest])] };
      } else if (propType instanceof Model) {
        return { [child]: constructTwo([schemaPair[1], ...rest]) };
      } else if (propType == number){
        return { [child]: value ? +value : null };
      } else {
        return { [child]: value };
      }

    };

    return constructTwo(fragments);
  }


  buildGroupBy(context, groupBy = []) {
    if (!groupBy.length) return '';

    const transducer = R.map(field => {
      const { alias, fieldName } = this.getPropPathRelated(context, field);
      return DOT(alias, fieldName);
    });
    return GROUP_BY(R.transduce(transducer, R.concat, [], groupBy));
  }

  buildOrderBy(context, orderBy = []) {
    if (!orderBy.length) return '';

    const transducer = R.map(orderByItem => {
      const { alias, fieldName } = this.getPropPathRelated(context, orderByItem.field);
      return `${DOT(alias, fieldName)} ${DE_A_SC(valueTrue(orderByItem.descending))}`;
    });
    return ORDER_BY(R.transduce(transducer, R.concat, [], orderBy));
  }

  buildFilters(context, filters = []) {
    return this.getFilterObjs(context, filters)
      .reduce((sofar, filterObj) => {
        const { field, operator, value, or } = filterObj;

        return sofar.concat([
          WHERE_OR_AND(sofar.length == 0, or, field, operator, value)
        ]);
      }, []).join(' ');
  }

  buildRootFrom(context, rootRelated, limit, pageIdx) {
    const { alias } = context.mapping[rootRelated.rootSchema];
    const fromSql = this.concatSnippets(
      this.buildRootFromSql(context, rootRelated),
      PAGER(limit, limit * pageIdx)
    );

    return FROM(`(${fromSql})`, alias);
  }

  buildRootFromSql(context, rootRelated) {
    const { tableName, alias } = context.mapping[rootRelated.rootSchema];
    return this.concatSnippets(
      SELECT('*'),
      FROM(tableName, alias),
      this.buildFilters(context, rootRelated.rootRelatedFilters),
      this.buildOrderBy(context, rootRelated.rootRelatedOrderBys)
    );
  }

  buildFrom(context, joinPaths = []) {
    const schemaNames = R.keys(context.mapping);
    let { tableName, alias } = context.mapping[schemaNames[0]];

    if (joinPaths.length == 0) {
      return FROM(tableName, alias);
    } else {
      return this.concatSnippets(
        FROM(tableName, alias),
        this.buildJoins(context, joinPaths)
      );
    }
  }

  buildJoins(context, joinPaths) {
    const ret = joinPaths
      .map(this.parseJoinPathToJoinPairs.bind(this));

    const joins = R.uniq(flatten1(ret)).map(pair => this.tableJoin(context, pair));
    return joins.map(this.buildJoin).join(' ');
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

      const aggrRelated = field ?
        this.getPropPathRelated(context, field) :
        null;

      const aggrProp = aggrRelated ?
        DOT(aggrRelated.alias, aggrRelated.fieldName) :
        DOT(alias, STAR);

      return AS(this.buildAggregationProp(aggregation, aggrProp), normalizedPath);
    }
  }

  buildAggregationProp(method, field) {
    return AGGRAGATION_METHODS[method](field);
  }

  getFilterObjs(context, filters) {
    const { hooks } = this._options;
    const { beforeConcatinatingFilters_ } = hooks || {};

    const avaliableFilters = filters.reduce((sofar, filter) => {
      const { field, value, operator, or } = filter;
      const { alias, fieldName, propName, schema } = this.getPropPathRelated(context, field);

      const matchedProp = schema._props[propName];
      const op = this.getOperator(operator || 'eq');

      if (!matchedProp) return sofar;
      const formattedVal = this.formatValue(matchedProp, op, value);

      return sofar.concat([{
        field: DOT(alias, fieldName),
        operator: op,
        value: formattedVal,
        matchedProp,
        or
      }]);

    }, []);

    return (beforeConcatinatingFilters_ || R.identity)(avaliableFilters, context);
  }

  getAllJoinPaths(propPaths, parsedFilterPaths) {
    return R.concat(
      this.findJoins(propPaths).map(R.prop('path')),
      this.getJoinsFromFilters(parsedFilterPaths)
    );
  }

  getJoinsFromFilters(parsedFilterPaths) {
    const found = parsedFilterPaths
      .map(R.compose(this.getPrefix.bind(this), R.prop('path')))
      .filter(p => this.countLevel(p) > 1);

    return R.uniq(found);
  }

  getPropPathRelated(context, propPath) {
    const normalized = this.normalizeFetchPath(context.parsedExp.paths, propPath);
    const relatedData = this.getPropPathRelated_(normalized);
    return R.merge(relatedData, { alias: context.mapping[relatedData.schema._schemaName].alias });
  }

  getPropPathRelated_(normalized) {
    const schemaName = this.getSchemaNameFromPropPath(normalized);

    const table = this._tableMap[schemaName];
    const { fieldName, propName } = this.getPropNameFromPropPath(table, normalized);
    const prop = table._schema._props[propName];

    return {
      normalizedPath: normalized,
      schema: table._schema,
      table,
      fieldName,
      propName,
      type: prop ? prop.type : ''
    };
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
      like: 'LIKE',
      between: 'BETWEEN',
      notEq: '<>',
      neq: '<>'
    };

    return operators[method];
  }

  formatValue(prop = {}, operator, value) {
    if (Array.isArray(value)) {
      return value.map(val => this.formatValue(prop, operator, val)).join(' AND ');
    } else if (prop.type == string) {
      return escape(operator == 'LIKE' ? `%${value}%`: `${value}`);
    } else if (prop.type == number) {
      return escape(value);
    } else if (prop.type == date) {
      return escape(dateParse(value));
    }

    return escape(value);
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

  createContext(parsedQuery) {
    const parsed = parsedQuery.parsedExp;
    const parsedFilters = parsedQuery.parsedFilters;

    const schemaPairsForPathes = this.getAllJoinPaths(parsed.paths, parsedFilters)
      .map(this.parseJoinPathToJoinPairs.bind(this))
      .map(joinPairsForPath => joinPairsForPath.map(this.schemaPair.bind(this)));

    const allWantedSchemas = R.union([parsed.paths[0].path], R.uniq(R.flatten(schemaPairsForPathes)));

    return {
      parsedExp: parsed,
      parsedFilters,
      mapping: allWantedSchemas.reduce((sofar, curr) => {
        const table = this._tableMap[curr];
        return R.merge(sofar, {
          [curr]: {
            table,
            tableName: table._tableName,
            alias: ALIAS(table._tableName)
          }
        });
      }, {})
    };
  }

  schemaPair(expressionPair) {
    const [parent, child] = expressionPair;
    const parentTable = this._tableMap[parent]._schema;
    if (!parentTable._props[child]) { return null; }
    return [parent, parentTable._props[child].type._schemaName];
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

  parseQuery(query) {
    const parsedExp = this.parseExpression(query.expression);
    const parsedFilters = this.parseFilters(parsedExp.paths, query.filters);

    return { parsedExp, parsedFilters };
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

  findJoins(propPaths) {
    return propPaths.filter(pathObj => {
      return this.countLevel(pathObj.path) > 1 && R.propEq('type', RELATION_PATH, pathObj);
    });
  }

  findProps(parsedExpression) {
    return parsedExpression.paths.filter(path => !path.computed && R.propEq('type', FIELD_PROP, path));
  }

  findAggragationProps(parsedExpression) {
    return parsedExpression.paths.filter(R.propEq('type', AGGRAGATION_PROP));
  }

  getTypeOfPathValue(path, propValue) {
    if (propValue.aggregation) {
      return AGGRAGATION_PROP;
    } else if (propValue instanceof Object){
      return RELATION_PATH;
    }
    return FIELD_PROP;
  }

  getPrefix(path) {
    return path.substring(0, path.lastIndexOf('.'));
  }

  parseFilters(paths, filters = []) {
    return filters.map(filter => {
      const normalizedPath = this.normalizeFetchPath(paths, filter.field);
      return { type: FILTER_PROP, path: normalizedPath, pathValue: filter.value };
    });
  }

  parseExpression(expression, parent = { path: '' } ) {

    const _this = this;
    const createPath = (parentPath, propName, propValue, alias = '') => {
      const path = formatPath(`${parentPath}.${propName}`);
      const type = this.getTypeOfPathValue(path, propValue);
      const related = type == FIELD_PROP ? this.getPropPathRelated_(path) : {};

      return {
        pathValue: propValue,
        path,
        alias,
        type,
        computed: related.type instanceof Computed,
        related
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

const valueTrue = value => value == true || value == 'true';

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
