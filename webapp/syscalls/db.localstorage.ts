export default {
  "db.put": (key: string, value: any) => {
    localStorage.setItem(key, value);
  },
  "db.get": (key: string) => {
    return localStorage.getItem(key);
  },
};
