# Creating a Development Database Branch

Use this if you want to test scraping/parsing without affecting the shared database.

## Steps

1. **Get access to the Neon project**
   - Ask the team lead to invite you to the Neon project
   - Or create your own Neon account at [neon.tech](https://neon.tech)

2. **Install Neon CLI**
   ```bash
   npm install -g neonctl
   npx neonctl auth
   ```

3. **Create your branch**
   ```bash
   npx neonctl branches create --name dev-yourname
   ```

4. **Get your connection string**
   ```bash
   npx neonctl connection-string dev-yourname
   ```

5. **Update your local `.env`**
   ```bash
   DATABASE_URL=<paste-your-branch-connection-string>
   ```

6. **Test**
   ```bash
   node test-scraper.js check-db
   ```

## Cleanup

Delete your branch when done:
```bash
npx neonctl branches delete dev-yourname
```

## Notes

- Your branch starts empty (schema only, no data)
- Changes to your branch don't affect the main database
- Switch back to the main `DATABASE_URL` when done testing
