FROM lukechannings/deno:v1.33.2
# The volume that will keep the space data
# Create a volume first:
#   docker volume create myspace
# Then bind-mount it when running the container with the -v flag, e.g.:
#   docker run -v myspace:/space -it zefhemel/silverbullet
VOLUME /space

# Accept TARGETARCH as argument
ARG TARGETARCH

# Adding tini manually, as it's not included anymore in the new baseimage
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-${TARGETARCH} /tini
# Copy the bundled version of silverbullet into the container
ADD ./dist/silverbullet.js /silverbullet.js

ENV SILVERBULLET_UID_GID 1000
ENV SILVERBULLET_USERNAME silverbullet

# Make sure the deno user has access to the space volume
RUN mkdir -p /space \
 && addgroup --gid ${SILVERBULLET_UID_GID} silverbullet \
 && adduser --uid ${SILVERBULLET_UID_GID} --gid ${SILVERBULLET_UID_GID} ${SILVERBULLET_USERNAME} \
 && chown -R ${SILVERBULLET_USERNAME}:${SILVERBULLET_USERNAME} /space \
 && chown -R ${SILVERBULLET_USERNAME}:${SILVERBULLET_USERNAME} /deno-dir \
 && chmod +x /tini \
 && echo "**** cleanup ****" \
 && apt-get -y autoremove \
 && apt-get clean  \
 && rm -rf \
    /tmp/* \
    /var/lib/apt/lists/* \
    /var/tmp/* \
    /var/log/* \
    /usr/share/man

# deno user id is 1000 in alpine image
USER ${SILVERBULLET_USERNAME}

# Expose port 3000
# Port map this when running, e.g. with -p 3002:3000 (where 3002 is the host port)
EXPOSE 3000

# Run the server, allowing to pass in additional argument at run time, e.g.
#   docker run -p 3002:3000 -v myspace:/space -it zefhemel/silverbullet --user me:letmein
ENTRYPOINT ["/tini", "--", "deno", "run", "-A", "--unstable", "/silverbullet.js", "--hostname", "0.0.0.0", "/space"]
