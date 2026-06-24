# Yardscout

A tool for a winter trailer-home placement business in the Salt Lake Valley. It scores residential backyards on one question — **can a trailer home physically be placed back there?** — then drives door-knocking against the yards that qualify. (`Yardscout` is a working name, not final.)

## Language

**Parcel**:
A single residential property lot, sourced from UGRC parcel data. Its polygon boundary is the property line shown on the map. The unit of evaluation.
_Avoid_: lot (informal alias OK in conversation), property record.

**Unit**:
The trailer home being placed. Defined by a footprint (width by length) and a required access width. The thing that must fit.
_Avoid_: trailer (ambiguous), home, RV.

**Footprint**:
The ground rectangle a Unit occupies. Drives the open-space requirement.

**Building footprint**:
The ground outline of the existing house on a Parcel. Subtracted from parcel area to estimate open backyard space.

**Open space**:
Estimated usable backyard area = Parcel area − Building footprint. The "is there room?" half of viability.

**Access**:
Whether a Unit can be *driven/backed* into the backyard, driven by side-yard clearance (the widest gap between the Building footprint and a lot line). Access does NOT decide viability — a Parcel with no Access is still viable by crane. Access decides the Placement method (and therefore cost).

**Placement method**:
How a Unit gets into the backyard. **Backed-in** when Access exists (cheapest, preferred). **Craned-in** when there is no Access — needs room out front for the crane to set up and clear overhead (power lines are the crane-killer, not in the data, confirmed in the field).

**Viability** (a.k.a. **Score**):
The auto-rating of a Parcel for placing a Unit. Driven mainly by Open space (is there room to set the Unit down?). Access does not gate viability; it sorts a viable Parcel into a Placement method. Practically a tier: green-drive (room + Access, cheap), green-crane (room, no Access, costs more), red (no room at all).
_Avoid_: rating (use Score as the alias), grade.

**Prospect**:
A Parcel whose Score is green; it lands on the knock list automatically, with no human pre-screen. A Parcel is a physical fact; a Prospect is a green one we are pursuing. Not every Parcel is a Prospect.
_Avoid_: lead (acceptable conversational alias), customer.

**Knock**:
A single field contact event at a Prospect, with an outcome (e.g. not home, not interested, interested, booked, do-not-knock) and optional notes. A Prospect has many Knocks over time.
_Avoid_: visit, contact, touch.

**Homeowner**:
The owner-occupant of a Parcel; the person whose door is knocked.

## Roles

**Office**:
The desk user. Sets thresholds, assigns territory, reviews Knock history and progress. Does NOT pre-screen yards — the green list is generated automatically.

**Field**:
The door-knocker. Gets the green list on a phone, sees own location against Prospects, glances at the satellite view if he wants, and records Knock outcomes. The Field visit is the only real verification of Access.

## Flagged ambiguities

**Business model deliberately out of scope.** Whether the Unit is sold/installed vs. rented as a lived-in dwelling, and whether anyone occupies it, does NOT affect the app. The app answers only "can the Unit go back there?" Occupancy, zoning, and utility hookups are explicitly excluded from Viability for v1.

## Example dialogue

> **Dev:** When you say a yard "works," you mean the Score is green?
> **Owner:** Right. Green means there's room and we can get the trailer back there.
> **Dev:** So a huge yard with the house built wall-to-wall on both sides is not green?
> **Owner:** Correct. No side gap, no access, doesn't matter how big the yard is. That's a red.
> **Dev:** And once it's green, it becomes a Prospect and the Field guy starts knocking it?
> **Owner:** Yeah, straight onto his list, nobody screens it first. He pulls up, sees if the trailer can really get back there, knocks, and logs it.
> **Dev:** So if the data was wrong and a fence blocks it?
> **Owner:** He marks it, it drops off the list, and we never drive out there again. Every Knock makes the map more right.
