Silverbullet supports [admonitions](https://github.com/community/community/discussions/16925) using GitHub syntax (`note` and `warning`).

> **note** This is a
> note admonition

> **warning** This is a
> warning admonition

Custom admonitions can be added in a [[Space Style]] using the following format:

```space-style
// Replace the keyword with a word or phrase of your choice
.sb-admonition[admonition="keyword"] {
    // The icon can be a link or an embedded image like shown here
  --admonition-icon: url('data:image/svg+xml,<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M19.5 12L14.5 17M19.5 12L14.5 7M19.5 12L9.5 12C7.83333 12 4.5 11 4.5 7" stroke="%231C274C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></g></svg>'); 
  // The accent color
  --admonition-color: green;
}
```
