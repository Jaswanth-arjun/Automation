# Status: the idle rig now has two swinging arm layers (cut from the folded paws), so pickup / put-down use the hamster's own arms.
# Still missing art for a fully physical hamster (what the current art cannot do)

The supplied storyboard has 8 flattened poses. The rig cuts eyes/ears/head/body/closed book out of them, which gives
real blinking, gaze, ear twitches, head sway and a book that rises from below. These actions still need NEW artwork:

1. PICK-UP FROM UNDERNEATH (6-8 frames): sitting -> looks down -> bends forward -> both paws reach under the belly
   -> grips the closed book -> lifts it -> sits upright holding it closed in both paws.
2. BOOK OPENING (4 frames): closed book held at chest -> cover swings open -> open book held (matches the "hold" pose).
3. PAGE TURN (best: separate transparent page layers, 3-5 frames of one page curling right -> left, plus the open book
   WITHOUT pages so pages can be animated in code). Today the page is drawn procedurally and is simple.
4. CELEBRATION WHILE HOLDING THE BOOK (6 frames): one paw raised / small hop, book kept in the other paw.
5. BOOK CLOSING + PUT DOWN (6 frames): looks down -> closes cover -> bends -> places the book under the body -> sits up.
6. SEPARATE LAYERS for every pose (so eyes/ears move independently without inpainting): eye whites+pupil+highlight on
   their own layer, upper eyelid (open / half / closed), each ear on its own layer, mouth shapes (smile / open smile /
   worried) on their own layer, headset on its own layer.

Format for all of it: transparent PNG, same canvas size per set (e.g. 1024x1180), identical ground line and horizontal
centre, same scale as the existing 8 poses, no sparkles/arrows/speech bubbles baked into calm poses.
Drop new frames into ANIMATIONS-style sequences (frame arrays) and the engine only needs a new step list per state.
