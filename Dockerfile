FROM lukechannings/deno:v1.38.2
# The volume that will keep the space data
# Create a volume first:
#   docker volume create myspace
# Then bind-mount it when running the container with the -v flag, e.g.:
#   docker run -v myspace:/space -p3000:3000 -it zefhemel/silverbullet
VOLUME /space

# Accept TARGETARCH as argument
ARG TARGETARCH

# Adding tini manually, as it's not included anymore in the new baseimage
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-${TARGETARCH} /tini


# Make sure the deno user has access to the space volume
RUN mkdir -p /space \
    && chmod +x /tini \
    && apt update \
    && apt install -y git ssh-client \
    && echo "**** cleanup ****" \
    && apt-get -y autoremove \
    && apt-get clean  \
    && rm -rf \
    /tmp/* \
    /var/lib/apt/lists/* \
    /var/tmp/* \
    /var/log/* \
    /usr/share/man


# Expose port 3000
# Port map this when running, e.g. with -p 3002:3000 (where 3002 is the host port)
EXPOSE 3000

ENV SB_HOSTNAME 0.0.0.0
ENV SB_FOLDER /space

# Copy the bundled version of silverbullet into the container
ADD ./dist/silverbullet.js /silverbullet.js
ADD ./docker-entrypoint.sh /docker-entrypoint.sh

# Run the server, allowing to pass in additional argument at run time, e.g.
#   docker run -p 3002:3000 -v myspace:/space -it zefhemel/silverbullet --user me:letmein
ENTRYPOINT ["/tini", "--", "/docker-entrypoint.sh"]
