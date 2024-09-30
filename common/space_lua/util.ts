export function evalPromiseValues(vals: any[]): Promise<any[]> | any[] {
  const promises = [];
  const promiseResults = new Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] instanceof Promise) {
      promises.push(vals[i].then((v: any) => promiseResults[i] = v));
    } else {
      promiseResults[i] = vals[i];
    }
  }
  if (promises.length === 0) {
    return promiseResults;
  } else {
    return Promise.all(promises).then(() => promiseResults);
  }
}
