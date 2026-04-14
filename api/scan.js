const { scanShop } = require("../lib/scan");

module.exports = async (req, res) => {
  try {
    const result = await scanShop();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(JSON.stringify(result, null, 2));
  } catch (error) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(500).send(
      JSON.stringify(
        {
          error: "scan_failed",
          message: error.message,
        },
        null,
        2,
      ),
    );
  }
};
