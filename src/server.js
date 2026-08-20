import dotenv from "dotenv";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env" : ".env.local",
});

const { default: app } = await import("./app.js");
const { checkDatabaseConnection } = await import("./config/db.js");
const port = Number(process.env.PORT || 4000);

checkDatabaseConnection()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Ecommerce API listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Unable to connect to the ecommerce database:", error);
    process.exit(1);
  });
