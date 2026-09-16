using System;
using System.Net;
using System.Net.Http;
using System.Collections.Generic;
using System.Threading.Tasks;

// Share Windows HTTP.sys port 80 using explicit host prefixes. Existing,
// more-specific service paths continue to be owned by their current services.
public static class CmmsWindowsProxy
{
    static readonly HashSet<string> HopHeaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
        "TE", "Trailer", "Transfer-Encoding", "Upgrade", "Host"
    };

    public static async Task Run(int backendPort)
    {
        using (var listener = new HttpListener())
        using (var client = new HttpClient(new HttpClientHandler {
            AllowAutoRedirect = false, UseCookies = false, UseProxy = false
        }))
        {
            client.Timeout = TimeSpan.FromSeconds(30);
            listener.Prefixes.Add("http://localhost:80/");
            listener.Prefixes.Add("http://127.0.0.1:80/");
            listener.Prefixes.Add("http://pd.local:80/");
            listener.Start();
            Console.WriteLine("CMMS HTTP.sys frontend ready on port 80; backend 127.0.0.1:" + backendPort);
            while (listener.IsListening)
            {
                var context = await listener.GetContextAsync().ConfigureAwait(false);
                _ = Forward(context, client, backendPort);
            }
        }
    }

    static async Task Forward(HttpListenerContext context, HttpClient client, int backendPort)
    {
        try
        {
            var incoming = context.Request;
            using (var request = new HttpRequestMessage(new HttpMethod(incoming.HttpMethod),
                "http://127.0.0.1:" + backendPort + incoming.RawUrl))
            {
                if (incoming.HasEntityBody) request.Content = new StreamContent(incoming.InputStream);
                request.Headers.Host = incoming.Headers["Host"];
                foreach (string header in incoming.Headers.AllKeys)
                {
                    if (HopHeaders.Contains(header) || header.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!request.Headers.TryAddWithoutValidation(header, incoming.Headers.GetValues(header)) && request.Content != null)
                        request.Content.Headers.TryAddWithoutValidation(header, incoming.Headers.GetValues(header));
                }
                using (var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
                {
                    context.Response.StatusCode = (int)response.StatusCode;
                    foreach (var header in response.Headers)
                        if (!HopHeaders.Contains(header.Key))
                            foreach (var val in header.Value) context.Response.AppendHeader(header.Key, val);
                    foreach (var header in response.Content.Headers)
                        if (!HopHeaders.Contains(header.Key) && !header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
                            foreach (var val in header.Value) context.Response.AppendHeader(header.Key, val);
                    if (response.Content.Headers.ContentLength.HasValue)
                        context.Response.ContentLength64 = response.Content.Headers.ContentLength.Value;
                    else if (incoming.HttpMethod != "HEAD" && context.Response.StatusCode != 204 && context.Response.StatusCode != 304)
                        context.Response.SendChunked = true;
                    if (incoming.HttpMethod != "HEAD" && context.Response.StatusCode != 204 && context.Response.StatusCode != 304)
                        await response.Content.CopyToAsync(context.Response.OutputStream).ConfigureAwait(false);
                }
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("CMMS proxy: " + error.GetType().Name);
            try { context.Response.StatusCode = 502; } catch { }
        }
        finally { try { context.Response.Close(); } catch { } }
    }
}
