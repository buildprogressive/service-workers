# [Build Progressive](https://buildprogressive.github.io) / Service Workers

Ready-to-use, documented Service Workers.
These files try to be both ready-to-use examples & learning opportunities, so all code has a lot of comments.

## Contents

### [Simple Service Worker](https://github.com/buildprogressive/service-workers/blob/master/simple/simple.js)

A really straight-forward Service Worker that works perfectly fine for small sites and blogs.

It will serve all static assets from cache if they're available (with a fallback to the network).
For HTML pages, it will always try to go over the network, but use the cache as a fallback.
