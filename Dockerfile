FROM node:18.6.0-slim

RUN mkdir /space
RUN chown node:node /space
USER node 
WORKDIR /space

RUN npx --yes @silverbulletmd/server || true 

EXPOSE 3000

CMD ["sh","-c","npx --yes @silverbulletmd/server --port 3000 /space"]
