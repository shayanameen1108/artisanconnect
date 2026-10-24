// The user-facing text the domain produces, in one place as #111's UI rule
// asks: email subjects, the shared refusals, and queue wording. The web app's
// own copy lives in web/copy.ts; both may read this module, and nothing in
// the domain reads web code.

/** The subject lines of emails the domain sends. */
const email = {
  codeSubject: {
    "email-verification": "Your ArtisanConnect sign-up code",
    "forget-password": "Your ArtisanConnect recovery code",
    "sign-in": "Your ArtisanConnect sign-in code",
    "change-email": "Your ArtisanConnect Email code",
  },
  signUpTried: "Someone tried to sign up with your Email",
  dataErased: "Your ArtisanConnect data is erased",
} as const;

/** The refusal messages that are not one command's own. */
const refusals = {
  adminOnly: "Only an Admin may do this.",
} as const;

/** Who a queue decision tells, said the same way on every item. */
const told = {
  nobody: "Nobody",
  accountByEmail: "The Account, by email",
  accountChosenWithReason: "The Account chosen, with the reason",
  artisanChosen: "The Artisan chosen",
  bothParties: "Both parties",
  bothPartiesWithReason: "Both parties, with the reason",
} as const;

/** A Data request's wording on the Admin's queue item and in its emails. */
const dataRequests = {
  kinds: {
    copy: "A copy of the data",
    erasure: "Erasure",
  },
  decisions: {
    "send-export": "Send the export",
    erase: "Erase the Account",
    refuse: "Refuse",
    withdrawn: "Withdrawn as the Account reopened",
  },
  labels: {
    asksFor: "Asks for",
    account: "Account",
    stillOwed: "Still owed to it",
    requestTab: "Request",
    kind: "Kind",
    name: "Name",
    email: "Email",
    openOnPeoplePage: "Open on the People page",
  },
} as const;

/** A Verification check's name, its file parts, and what to send, said for the Artisan. */
const checks = {
  identity: {
    name: "Identity document",
    document: "The identity document (front, and back if it has one)",
    selfie: "A selfie holding it",
    hint: "A South African ID, a refugee ID, or a passport, and a selfie of you holding it.",
  },
  workPermit: {
    name: "Work permit",
    document: "The work permit",
    hint: "Needed with a foreign passport: a permit that lets you work for yourself, such as permanent residence or an exemption permit. Give its expiry date unless it never expires.",
  },
  payoutAccount: {
    name: "Payout account",
    document: "A bank confirmation letter",
    hint: "A letter from your bank confirming the account is in your own name. Payouts go here.",
  },
  workPhotos: {
    name: "Work photos",
    photos: "Three photos",
    hint: "Three photos of finished work you did yourself.",
  },
  trainedPlumber: {
    name: "Trained plumber",
    document: "The trade test or certificate",
    hint: "A trade test, a certificate of proficiency, or NQF 3 Construction Plumbing.",
  },
  gasPractitioner: {
    name: "Gas practitioner registration",
    document: "The SAQCC Gas registration",
    hint: "Optional. A current SAQCC Gas registration lets you Quote on Jobs that install or remove gas.",
  },
  registeredPerson: {
    name: "Registered person",
    document: "The registration certificate",
    hint: "Your registration as an electrical tester, installation electrician, or master installation electrician, in your own name.",
  },
  electricalContractor: {
    name: "Electrical contractor registration",
    document: "The registration certificate",
    hint: "Your current electrical contractor registration, in your own name. It is renewed yearly.",
  },
  policeClearance: {
    name: "Police clearance",
    document: "The police clearance certificate",
    hint: "Optional. Shown on your Profile with the day it was issued.",
  },
  businessInsurance: {
    name: "Business insurance",
    document: "The insurance certificate",
    hint: "Optional. Shown on your Profile with its expiry date.",
  },
  documentTypes: {
    "sa-id": "South African ID",
    "refugee-id": "Refugee ID",
    passport: "Passport",
  },
} as const;

export const copy = { email, refusals, told, dataRequests, checks };
