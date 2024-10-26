export const urlPrefix = Deno.env.get('SB_URL_PREFIX') ?? (globalThis.silverBulletConfig ? globalThis.silverBulletConfig.urlPrefix : null) ?? '';

export const toRealUrl = <T extends (string | URL)>(url : T) : T => {
    if (typeof url === 'string') {
        const stringUrl = url as string;
        if (stringUrl.startsWith('http://') || stringUrl.startsWith('https://')) {
            const parsedUrl = new URL(stringUrl);
            parsedUrl.pathname = urlPrefix + parsedUrl.pathname;
            //console.log("Converted ", url, parsedUrl.href)
            return String(parsedUrl.href) as T;
        }
        else {
            if (!stringUrl.startsWith('/')) {
                console.log("Don't know how to deal with relative path: ", url);
            }
            //console.log("Converted ", url, urlPrefix + stringUrl)
            return (urlPrefix + stringUrl) as T;
        }
    }
    else if (url.protocol === 'http:' || url.protocol === 'https:') {
        const parsedUrl = new URL(url as URL);
        parsedUrl.pathname = urlPrefix + parsedUrl.pathname;
        //console.log("Converted ", url, parsedUrl)
        return parsedUrl as T;
    }
    else {
        return url;
    }
};

export const toInternalUrl = (url : string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        var parsedUrl = new URL(url);
        if (parsedUrl.pathname.startsWith(urlPrefix)) {
            parsedUrl.pathname = parsedUrl.pathname.substr(urlPrefix.length);
            return parsedUrl.href;
        }
        else {
            return url;
        }
    } else if (url.startsWith(urlPrefix)) {
        return url.substr(urlPrefix.length);
    }
    else {
        console.log("Don't know how to deal with relative path: ", url);
        return url;
    }
};

