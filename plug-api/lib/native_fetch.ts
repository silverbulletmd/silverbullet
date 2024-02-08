declare global {
  function nativeFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response>;
}
