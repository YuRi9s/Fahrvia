# Stage 6 — Category lifecycle and vehicle relationships

Version 0.1.6 delivers this stage only. Stage 7 will address physical key lifecycle.

## Upgrade

Preserve your `.env`, database and private files. Back up the database using your normal process, update the application source, and run:

```sh
npm ci --ignore-scripts --omit=peer
npm run db:generate
npm run db:migrate
npm run dev
```

For production, use your normal build/restart procedure after migration. Do not reset the database or rerun bootstrap.

The additive migration adds category status/version and optional vehicle brand/provider references with tenant-scoped foreign keys. It links exact existing brand/provider labels to matching categories within the same organization. Unmatched text, vehicle identity and operational history are preserved. No category or vehicle is deleted.

## Delivered behavior

- Administrators create, rename, archive and restore categories. Renames and status changes require a reason and the current version. Types stay fixed; duplicate names within a type/organization are rejected, including archived names.
- Categories show active/inactive status and linked-vehicle counts. Status filters and name search apply to the full dataset.
- Vehicle brand/provider fields offer searchable active-category suggestions with pagination. Selecting an entry stores its ID. Existing archived links stay visible and may be retained when editing other vehicle fields.
- Renaming a category updates linked vehicle labels. Archiving keeps existing links and removes the category from new choices. Restoring makes it selectable again.
- Custom/legacy vehicle text is still supported. Existing matching categories are resolved by the server; an archived name cannot bypass the restriction by being typed manually. Creating a category attaches exact matching unlinked vehicle labels.
- Station/group categories can be managed as labels, but no station/group assignment fields exist yet. Inventory's category text is a separate existing field and is not remapped to these types.
- Confirmation and category-result transitions respect reduced motion.

## User test checklist

1. Under **Kategorien**, create a brand and provider. Try the same name with different capitalization; expect a duplicate error.
2. Create or edit a vehicle. Search and select the brand; for a rented vehicle, select the provider. Verify values survive saving/reopening.
3. Rename the category with a reason. Confirm the linked vehicle shows the new name and usage count stays correct.
4. Archive the category. Confirm the existing vehicle retains it and other vehicle edits still work. New vehicles must not be able to select or type that archived category as a new assignment.
5. Filter categories to **Inaktiv**, restore it and verify it becomes available again.
6. Open a category in two tabs, save a change in one and submit the stale dialog in the other. Expect a conflict; close, refresh and reopen.
7. Verify dispatchers can use active category suggestions but cannot modify categories. Drivers must not access category administration.
8. Check names beyond the first result page, cancel/Escape, required reasons, keyboard focus, mobile layout and reduced-motion preferences.

Browser/mobile and production deployment acceptance remain pending. Automated results are in `STAGE-06-VERIFICATION.md`.
