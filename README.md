# Audioserver

**Initial Release v1.0.0**

Audioserver is a self-hosted multiroom audio server. It collects local files, streaming
services, radio and line-in, and plays them in sync on the speakers you already own.
It can run on its own or as a Loxone Audioserver.

## Quick start

```bash
docker compose up -d --build
```

`docker-compose.yml` builds the image from the Dockerfile in this repository and keeps
configuration under the `audioserver-data` volume. Then open `http://<server-ip>:7090`.
**Player** is the client, **Admin** is the setup surface.

Coolify uses the same file. Add the Git repository as a Docker Compose resource and
leave the compose path at `docker-compose.yml`. The service uses the host network so
speaker discovery works, and is reached at port 7090 on the machine, not through the
Coolify proxy.
Create the admin account and walk the three steps: **Content** — add your music. **Access** —
switch on how to reach it. **Zones** — only if you want rooms.

The HTTP gateway listens on port 7090. The public API is described in
[INTEGRATING.md](INTEGRATING.md).

Spotify needs your own application: set the client id in the config, register the redirect
`https://<server>:7090/callbacks/spotify/` (or `SPOTIFY_REDIRECT_URI`), and leave the Web
Playback scopes off. Spotify refuses plain http for anything but `127.0.0.1`, so port 7090
also answers https with a self-signed certificate; the browser warns about it once during
sign-in. Playback uses Soloist.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under
[Apache-2.0](LICENSE).
