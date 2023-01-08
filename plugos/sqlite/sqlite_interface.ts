export interface ISQLite {
  execute(query: string, ...params: any[]): Promise<number>;
  query(query: string, ...params: any[]): Promise<any[]>;
}
