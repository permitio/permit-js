

export const sendTokenToIframe = (token: string) => {
    let tokenSent = false;

    const iframeRef = document?.querySelector('iframe');
    const iframeWindow = iframeRef?.contentWindow;

    if (!iframeRef) {
        console.error("Iframe not found");
        const timer = setTimeout(() => {
            sendTokenToIframe(token)
            clearTimeout(timer)
        }, 1200)
        return;
    }

    if (!iframeWindow) {
        console.error("Iframe contentWindow is null");
        const timer = setTimeout(() => {
            sendTokenToIframe(token)
            clearTimeout(timer)
        }, 1200)
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
    const maxAttempts = 20; // Adjust as needed

    const interval = setInterval(() => {
        if (tokenSent) {
            clearInterval(interval);
            return;
        }

        iframeWindow?.postMessage({type: 'permitToken', permitToken: token}, "*");
        window.addEventListener("message", messageListener);

        attempts++;

        if (attempts >= maxAttempts) {
            clearInterval(interval);
            console.error("We haven't recognized your element in a while.");
        }
    }, 400);
};