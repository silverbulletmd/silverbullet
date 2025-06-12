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

/**
 * return the mid value among x, y, and z
 * @param x
 * @param y
 * @param z
 * @param compare
 * @returns {Promise.<*>}
 */
async function getPivot(
  x: any,
  y: any,
  z: any,
  compare: (a: any, b: any) => Promise<number>,
) {
  if (await compare(x, y) < 0) {
    if (await compare(y, z) < 0) {
      return y;
    } else if (await compare(z, x) < 0) {
      return x;
    } else {
      return z;
    }
  } else if (await compare(y, z) > 0) {
    return y;
  } else if (await compare(z, x) > 0) {
    return x;
  } else {
    return z;
  }
}

/**
 * asynchronous quick sort
 * @param arr array to sort
 * @param compare asynchronous comparing function
 * @param left index where the range of elements to be sorted starts
 * @param right index where the range of elements to be sorted ends
 * @returns {Promise.<*>}
 */
export async function asyncQuickSort(
  arr: any[],
  compare: (a: any, b: any) => Promise<number>,
  left = 0,
  right = arr.length - 1,
) {
  if (left < right) {
    let i = left, j = right, tmp;
    const pivot = await getPivot(
      arr[i],
      arr[i + Math.floor((j - i) / 2)],
      arr[j],
      compare,
    );
    while (true) {
      while (await compare(arr[i], pivot) < 0) {
        i++;
      }
      while (await compare(pivot, arr[j]) < 0) {
        j--;
      }
      if (i >= j) {
        break;
      }
      tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;

      i++;
      j--;
    }
    await asyncQuickSort(arr, compare, left, i - 1);
    await asyncQuickSort(arr, compare, j + 1, right);
  }
  return arr;
}
