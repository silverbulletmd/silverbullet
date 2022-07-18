FROM node:slim

RUN mkdir /space
RUN chown node:node /space
USER node 
WORKDIR /space

EXPOSE 3000

CMD ["sh","-c","npx --yes @silverbulletmd/server --port 3000 /space"]