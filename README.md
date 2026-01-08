# Website Rule Checker

A Next.js application that allows you to define rules and scan websites to check if they meet your requirements using OpenAI's API.

## Features

- **Rule Management**: Define and manage custom rules for website compliance
- **Website Scanning**: Scan any website URL and check if it meets your defined rules
- **AI-Powered Analysis**: Uses OpenAI GPT-4o-mini to analyze website content against your rules
- **Detailed Results**: Get detailed feedback on which rules pass or fail

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure OpenAI API Key:**
   - Copy `.env.local.example` to `.env.local`
   - Add your OpenAI API key:
     ```
     OPENAI_API_KEY=your_openai_api_key_here
     ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1. **Define Rules:**
   - Go to the "Rules" page
   - Add rules with a title and description
   - Examples:
     - "Privacy Policy Required" - "Website must have a privacy policy page"
     - "HTTPS Required" - "Website must use HTTPS"
     - "Contact Information" - "Website must display contact information"

2. **Scan Websites:**
   - Go to the "Scanner" page
   - Enter a website URL
   - Click "Scan Website"
   - View results showing which rules pass or fail

## Project Structure

```
├── app/
│   ├── api/
│   │   └── scan/
│   │       └── route.ts      # API endpoint for website scanning
│   ├── rules/
│   │   └── page.tsx          # Rules management page
│   ├── scanner/
│   │   └── page.tsx          # Website scanner page
│   ├── layout.tsx            # Root layout
│   ├── page.tsx              # Home page
│   └── globals.css           # Global styles
├── package.json
└── README.md
```

## Technologies Used

- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **OpenAI API** - AI-powered website analysis
- **LocalStorage** - Client-side rule storage

## Notes

- Rules are stored in browser localStorage
- Website content is fetched and analyzed using OpenAI
- The system checks each rule individually and provides detailed feedback

