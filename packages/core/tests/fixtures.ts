/** HTML fixtures with known defects; each test asserts exactly what should be extracted. */

export const ARTICLE = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <title>Fish &amp; Chips — The Complete Guide</title>
  <meta name="description" content="Everything about fish &amp; chips.">
  <meta name="robots" content="index, follow">
  <meta name="viewport" content="width=device-width">
  <meta property="og:title" content="Fish and chips">
  <link rel="canonical" href="/guide/">
  <link rel="alternate" hreflang="en-gb" href="https://example.com/guide/">
  <link rel="alternate" hreflang="fr" href="https://example.com/fr/guide/">
  <link rel="alternate" hreflang="english" href="https://example.com/bad/">
  <link rel="stylesheet" href="http://cdn.example.net/site.css">
  <link rel="next" href="/guide/page/2/">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","author":"Me"}</script>
  <script src="/app.js"></script>
  <style>.hidden { display: none }</style>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/about">About&nbsp;us</a></nav>
  <svg><title>icon title</title><path d="M0"/></svg>
  <h1>Fish &amp; chips</h1>
  <h3>Skipped a level</h3>
  <h2>History</h2>
  <p>Fried fish with chips is a hot dish. <a href="/history" rel="nofollow">click here</a>.</p>
  <p>Visit <a href="https://other.example.org/page">our friends</a> or <a href="mailto:a@b.c">mail</a>.</p>
  <a href="/gallery"><img src="/img/cod.jpg" alt="A battered cod"></a>
  <img src="/img/no-alt.png" width="10">
  <img data-src="/img/lazy.webp" alt="">
  <form action="http://example.com/subscribe"></form>
  <div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Cod</span></div>
  <footer><a href="/privacy">Privacy</a></footer>
  <script>var x = "not text";</script>
</body>
</html>`;
