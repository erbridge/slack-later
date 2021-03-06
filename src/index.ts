import app from "./app";

process.addListener("unhandledRejection", (err) => {
  console.error(err);
});

process.addListener("uncaughtException", (err) => {
  console.error(err);
});

(async () => {
  await app.start(parseInt(process.env.PORT || "3000"));

  console.log("⚡️ Later is running!");
})();
