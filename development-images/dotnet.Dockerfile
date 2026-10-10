FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS supervisor
FROM mcr.microsoft.com/dotnet/sdk:10.0-noble@sha256:e70cdb7f80b0348f5cb85f19a8f670fca061f033d57eed12fa003d58b0e06317
COPY --from=supervisor /usr/local/bin/node /usr/local/bin/node
COPY --from=supervisor /usr/local/LICENSE /usr/local/share/doc/relay-node/LICENSE
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_NOLOGO=1 DOTNET_CLI_HOME=/tmp/dotnet NUGET_PACKAGES=/tmp/nuget
RUN node --version && dotnet --version
