


# NoteJet
![concept](/public/promote.svg)

NoteJet is a Chrome extension that sends the current page into NotebookLM with fewer manual steps.

## Before you start

- Install Bun 1.x.
- Make sure you can sign in to NotebookLM in Chrome.

## Install the extension

1. Run `bun install`.
2. Run `bun run build`.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the `dist/` folder.

After code changes, run `bun run build` again and click **Reload** on the extension card.

## What NoteJet does

- Captures the title and URL of the current tab.
- Shows recent notebooks and lets you search existing notebooks.
- Lets you create a new notebook.
- Imports the current page URL into the selected notebook.
- Lists videos from a YouTube channel profile and imports selected videos one by one.
- Checks whether the current page is allowed by your import whitelist.

## Basic workflow

1. Open the webpage you want to save.
2. Open the NoteJet popup.
3. Check the captured page title and source URL.
4. Confirm the source is allowed by the whitelist.
5. Search for a notebook or create a new one.
6. Select a notebook.
7. Click **Import**.

If the import succeeds, the popup will show a success message.

## Import YouTube channel videos

YouTube channel import only appears when the current tab is a YouTube channel profile, such as:

- `https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA`
- `https://www.youtube.com/@MrBeast`

Before using it, open **Edit import whitelist** and add a YouTube Data API key. Google’s setup guide is linked from the options page:
<https://developers.google.com/youtube/v3/getting-started>

Workflow:

1. Open a YouTube channel profile.
2. Open the NoteJet popup.
3. Select or create the NotebookLM notebook.
4. Click **Import YouTube channel**.
5. Search or scroll the video list.
6. Check the videos to import.
7. Click **Import selected videos**.

NoteJet imports selected videos sequentially. If one video fails, the batch continues and the popup reports the imported and failed counts.

## Sign in to NotebookLM

NoteJet needs an active NotebookLM session before it can search notebooks, create notebooks, or import URLs.

If you are not signed in:

- the popup will show `NotebookLM login expired. Please sign in again.`
- the main actions will stay disabled
- the link at the bottom will change to `Sign in to NotebookLM`

Click that link to open NotebookLM and sign in, then return to the popup and click **Refresh session**.

## Manage the import whitelist

Click **Edit import whitelist** in the popup to open the options page.

The whitelist supports these formats:

- `*` to allow all HTTP and HTTPS websites
- `example.com` to allow one exact host
- `*.example.com` to allow subdomains
- `https://example.com` to allow one host with a specific scheme

Rules to know:

- only HTTP and HTTPS pages can be imported
- browser pages such as `chrome://` and local files are blocked
- if the current page is not allowed, the popup will show a message and the import button will stay disabled

## Create a new notebook

1. Open the popup.
2. Type a notebook name in **New notebook name**.
3. Click **Create**.
4. Wait for the success message.

The new notebook should appear in the notebook list and become the selected target.

## Open a notebook manually

Use the link at the bottom of the popup to open the selected notebook in a new tab.

If no notebook is selected, the link stays hidden.
If you are signed out, the link opens the NotebookLM home page instead.

## Privacy and local data

NoteJet stores local extension data to keep the workflow usable between sessions.

This includes:

- recent notebook entries
- import whitelist settings
- YouTube Data API key
- NotebookLM session state

## Demo(youtube)

[![NoteJet Demo](https://img.youtube.com/vi/j7HyZ3pRsks/0.jpg)](https://www.youtube.com/watch?v=jwmdcoKd-gk)
