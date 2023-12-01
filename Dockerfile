FROM node:18-bullseye-slim
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get autoremove -y
WORKDIR /app
COPY ["package.json", "./"]
RUN npm i --omit=dev
COPY . .
RUN mkdir -p ./encrypted/data \
    && mkdir -p ./uploads

EXPOSE 3000

CMD ["node", "--use-strict", "index.js"]