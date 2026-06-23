To better understand what SilverBullet is doing, especially when [[Troubleshooting]], it is good to know where and how to look at SilverBullet logs.

Most valuable logs are likely going to be in your browser’s logs, so especially if you’re a power user, get comfortable opening your JavaScript console.

* Client logs: Check your browser’s JavaScript console. Usually these are part of “(Web) Developer Tools” buried somewhere in a Tools or Developer menu.
* Service worker logs (especially useful when debugging [[Sync]] issues):
  * In Chromium-based browsers these logs are mixed with the regular JavaScript console.
  * In Firefox start at `about:debugging#/runtime/this-firefox` then find it under the Service Worker section and click “Inspect”.
  * In Safari they can be accessed via `Developer > Service workers`.
* Server logs: Server logs are written to the standard output of the server process.
* Reverse proxy logs: if you use some sort of reverse proxy, check those as well. Reverse proxies may do some surprising stuff, like block certain requests.
