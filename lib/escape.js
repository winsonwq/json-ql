const dateToString = (date) => {
  var dt = dateParse(date);

  var year        = dt.getUTCFullYear();
  var month       = dt.getUTCMonth() + 1;
  var day         = dt.getUTCDate();
  var hour        = dt.getUTCHours();
  var minute      = dt.getUTCMinutes();
  var second      = dt.getUTCSeconds();
  var millisecond = dt.getUTCMilliseconds();

  // YYYY-MM-DD HH:mm:ss.mmm
  return zeroPad(year, 4) + '-' + zeroPad(month, 2) + '-' + zeroPad(day, 2) + ' ' +
    zeroPad(hour, 2) + ':' + zeroPad(minute, 2) + ':' + zeroPad(second, 2) + '.' +
    zeroPad(millisecond, 3);
};

const zeroPad = (number, length) => {
  number = number.toString();
  while (number.length < length) {
    number = '0' + number;
  }

  return number;
};

export const dateParse = date => {
  const time = Number(date);
  return time ? new Date(time) : new Date(date);
};

export default val => {
  if (val === undefined || val === null) { return 'NULL'; }
  if (typeof val == 'number') { return Number(val); }

  if (val instanceof Date) {
    val = dateToString(val);
  }

  val = val.replace(/[\0\n\r\b\t\\\'\"\x1a]/g, function(s) {
    switch(s) {
      case '\0': return '\\0';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\b': return '\\b';
      case '\t': return '\\t';
      case '\x1a': return '\\Z';
      case '\'': return '\'\'';
      default: return '\\'+s;
    }
  });

  return '\'' + val + '\'';
};
