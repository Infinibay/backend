import startServer from './startServer';

startServer()
  .then((app) => {
    const port = process.env.PORT || 4000;
    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
