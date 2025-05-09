
const TIME_TIMEOUT = 1200;
const MAX_ATTEMPTS = 20;
const TIME_INTERVAL = 400;

export const sendTokenToIframe = (token: string,elementIframeUrl:string) => {
    let tokenSent = false;

    const iframeRef = document?.querySelector(`iframe[src="${elementIframeUrl}"]`);

    if (!iframeRef) {
        console.info(`Element iframe with ${elementIframeUrl} not found retrying in ${TIME_TIMEOUT}ms`);
        const timer = setTimeout(() => {
            sendTokenToIframe(token, elementIframeUrl)
            clearTimeout(timer)
        }, TIME_TIMEOUT)
        return;
    }

    const iframeWindow = (<HTMLIFrameElement> iframeRef).contentWindow;

    if (!iframeWindow) {
        console.info("Element iframe contentWindow is null");
        const timer = setTimeout(() => {
            sendTokenToIframe(token, elementIframeUrl)
            clearTimeout(timer)
        }, TIME_TIMEOUT)
        return;
    }


    const messageListener = (event: MessageEvent) => {
        if (event.data && event.data.type === "permitTokenReceived") {
            tokenSent = true;
            clearInterval(interval);
            window.removeEventListener("message", messageListener);
        }
    };

    let attempts = 0;

    const interval = setInterval(() => {
        if (tokenSent) {
            clearInterval(interval);
            return;
        }

        iframeWindow?.postMessage({type: 'permitToken', permitToken: token}, elementIframeUrl);
        window.addEventListener("message", messageListener);

        attempts++;

        if (attempts >= MAX_ATTEMPTS) {
            clearInterval(interval);
            console.error("We haven't recognized your element in a while.");
        }
    }, TIME_INTERVAL);
};