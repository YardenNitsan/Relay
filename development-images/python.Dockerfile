FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS supervisor
FROM python:3.14-slim-bookworm@sha256:48b13b003dda20b16f9442b8475aa05fe21bf6579a8c881db92ffb4d8fd20f83
COPY --from=supervisor /usr/local/bin/node /usr/local/bin/node
COPY --from=supervisor /usr/local/LICENSE /usr/local/share/doc/relay-node/LICENSE
ENV PYTHONDONTWRITEBYTECODE=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN node --version && python3 -I --version
