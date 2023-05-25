import {
  regStrip,
  tcDefaults,
} from "./common"
///"ytJS" sadly cant figure out a good way to execute js https://bugs.chromium.org/p/chromium/issues/detail?id=1207006 may eventually have a solution
const SettingFieldsBeforeSync = new Map();
SettingFieldsBeforeSync.set("blacklist", (data) => data.replace(regStrip, ""));
const SettingFieldsSynced = Object.keys(tcDefaults)
const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;

var tc = {
  settings: {
    ...tcDefaults
  },
  // Holds a reference to all of the AUDIO/VIDEO DOM elements we've attached to
  mediaElements: []
};
let speedSet = []

for (let field of SettingFieldsSynced){
  if (tcDefaults[field] === undefined)
    log(`Warning a field we sync: ${field} not found on our tc.settings class likely error`, 3);
}

function log(message, level=4) {
  if (tc.settings.logLevel >= level) {
    message = `${log.caller?.name ?? "unknown"}: ${message}`;
    if (level === 2) {
      console.log("ERROR:" + message);
    } else if (level === 3) {
      console.log("WARNING:" + message);
    } else if (level === 4) {
      console.log("INFO:" + message);
    } else if (level === 5) {
      console.log("DEBUG:" + message);
    } else if (level === 6) {
      console.log("DEBUG (VERBOSE):" + message);
      console.trace();
    }
  }
}

chrome.storage.sync.get(tc.settings, function (storage) {
  tc.settings.keyBindings = storage.keyBindings; // Array
  if (storage.keyBindings.length == 0) {
    storage.keyBindings = [ ...tcDefaults.keyBindings];
    tc.settings.version = tcDefaults.version;
    let toSet = {};
    for (let _field of SettingFieldsSynced){
      let val = tc.settings[_field];
      if (SettingFieldsBeforeSync.has(_field))
        val = SettingFieldsBeforeSync.get(_field)(val);
      toSet[_field] = val;
    }
    chrome.storage.sync.set(toSet);
  }
  
  for (let field of SettingFieldsSynced){
    let origType = typeof(tcDefaults[field]);
    switch (origType){
        case "string":
          tc.settings[field] = String(storage[field]);
          break;
        case "number":
            tc.settings[field] = Number(storage[field]);
          break;
        case "boolean":
          tc.settings[field] = Boolean(storage[field]);
          break;
        default:
          tc.settings[field] = storage[field];
          break;
    }
  }

  initializeWhenReady(document);
});

function getKeyBindings(action, what = "value") {
  try {
    return tc.settings.keyBindings.find((item) => item.action === action)[what];
  } catch (e) {
    return false;
  }
}
function setKeyBindings(action, value) {
  tc.settings.keyBindings.find((item) => item.action === action)[
    "value"
  ] = value;
}
let strTemplate = '${name} : ${speed3}'
let injectTemplate =(obj)=> strTemplate.replace(/\${(.*?)}/g, (x,g)=> obj[g])
function formatSpeedIndicator(speed) {
  let percent = (speed * 100)
  return injectTemplate({
    name: speedSet[0][0],
    percent: percent.toFixed(0) +'%',
    percent1: percent.toFixed(1) +'%',
    percent2: percent.toFixed(2) +'%',
    speed: speed,
    speed2: Number(speed).toFixed(2),
    speed3: Number(speed).toFixed(3),
    // speed4: Number(speed).toFixed(4),
  })
}

function defineVideoController() {
  speedSet = tc.settings.speedSets[tc.settings.speedSetChosen]
  // Data structures
  // ---------------
  // videoController (JS object) instances:
  //   video = AUDIO/VIDEO DOM element
  //   parent = A/V DOM element's parentElement OR
  //            (A/V elements discovered from the Mutation Observer)
  //            A/V element's parentNode OR the node whose children changed.
  //   div = Controller's DOM element (which happens to be a DIV)
  //   speedIndicator = DOM element in the Controller of the speed indicator

  // added to AUDIO / VIDEO DOM elements
  //    vsc = reference to the videoController
  tc.videoController = function (target, parent) {
    if (target.vsc) {
      return target.vsc;
    }

    tc.mediaElements.push(target);

    this.video = target;
    this.parent = target.parentElement || parent;
    storedSpeed = tc.settings.playersSpeed[target.currentSrc];
    if (!tc.settings.rememberSpeed) {
      if (!storedSpeed) {
        log("Setting stored speed to 1.0; rememberSpeed is disabled", 5);
        storedSpeed = 1.0;
      }
      setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
    } else {
      storedSpeed = tc.settings.lastSpeed;
      log(`Recalled stored speed due to rememberSpeed being enabled: ${storedSpeed}`, 5);
    }

    log("Explicitly setting playbackRate to: " + storedSpeed, 5);
    target.playbackRate = storedSpeed;

    this.div = this.initializeControls();

    var mediaEventAction = function (event) {
      storedSpeed = tc.settings.playersSpeed[event.target.currentSrc];
      if (!tc.settings.rememberSpeed) {
        if (!storedSpeed) {
          log("Setting stored speed to 1.0 (rememberSpeed not enabled)", 4);
          storedSpeed = 1.0;
        }
        // resetSpeed isn't really a reset, it's a toggle
        log("Setting reset keybinding to fast", 5);
        setKeyBindings("reset", getKeyBindings("fast")); // resetSpeed = fastSpeed
      } else {
        log("Recalling stored speed; rememberSpeed is enabled_", 5);
        storedSpeed = tc.settings.lastSpeed;
      }
      // TODO: Check if explicitly setting the playback rate to 1.0 is
      // necessary when rememberSpeed is disabled (this may accidentally
      // override a website's intentional initial speed setting interfering
      // with the site's default behavior)
      log("Explicitly setting playbackRate to: " + storedSpeed, 4);
      setSpeed(event.target, storedSpeed, 'explicit');
    };

    target.addEventListener(
      "play",
      (this.handlePlay = mediaEventAction.bind(this))
    );

    target.addEventListener(
      "seeked",
      (this.handleSeek = mediaEventAction.bind(this))
    );

    var observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          (mutation.attributeName === "src" ||
            mutation.attributeName === "currentSrc")
        ) {
          log("mutation of A/V element", 5);
          var controller = this.div;
          if (!mutation.target.src && !mutation.target.currentSrc) {
            controller.classList.add("vsc-nosource");
          } else {
            controller.classList.remove("vsc-nosource");
          }
        }
      });
    });
    observer.observe(target, {
      attributeFilter: ["src", "currentSrc"]
    });
  };

  tc.videoController.prototype.remove = function () {
    this.div.remove();
    this.video.removeEventListener("play", this.handlePlay);
    this.video.removeEventListener("seek", this.handleSeek);
    delete this.video.vsc;
    let idx = tc.mediaElements.indexOf(this.video);
    if (idx != -1) {
      tc.mediaElements.splice(idx, 1);
    }
  };

  tc.videoController.prototype.initializeControls = function () {
    log("Begin", 5);
    const document = this.video.ownerDocument;
    const rect = this.video.getBoundingClientRect();
    // getBoundingClientRect is relative to the viewport; style coordinates
    // are relative to offsetParent, so we adjust for that here. offsetParent
    // can be null if the video has `display: none` or is not yet in the DOM.
    const offsetRect = this.video.offsetParent?.getBoundingClientRect();
    const top = Math.max(rect.top - (offsetRect?.top || 0), 33) + "px";
    const left = Math.max(rect.left - (offsetRect?.left || 0), 33) + "px";

    var wrapper = document.createElement("div");
    wrapper.classList.add("vsc-controller");
    if (!this.video.currentSrc) wrapper.classList.add("vsc-nosource");
    if (tc.settings.startHidden) wrapper.classList.add("vsc-hidden");

    var shadow = wrapper.attachShadow({ mode: "open" });
    var shadowTemplate = `
        <style>
          @import "${chrome.runtime.getURL("shadow.css")}";
        </style>

        <div id="controller" style="top:${top}; left:${left}; opacity:${
      tc.settings.controllerOpacity
    }">
          <span data-action="drag" class="draggable">--</span>
          <span id="controls">
            <button data-action="rewind" class="rw">«</button>
            <button data-action="slower">&minus;</button>
            <button data-action="faster">&plus;</button>
            <button data-action="advance" class="rw">»</button>
            <button data-action="display" class="hideButton">&times;</button>
          </span>
        </div>
      `;
    shadow.innerHTML = shadowTemplate;
    shadow.querySelector(".draggable").addEventListener(
      "mousedown",
      (e) => {
        runAction(e.target.dataset["action"], false, e);
        e.stopPropagation();
      },
      true
    );

    shadow.querySelectorAll("button").forEach(function (button) {
      button.addEventListener(
        "click",
        (e) => {
          runAction(
            e.target.dataset["action"],
            getKeyBindings(e.target.dataset["action"]),
            e
          );
          e.stopPropagation();
        },
        true
      );
    });

    shadow
      .querySelector("#controller")
      .addEventListener("click", (e) => e.stopPropagation(), false);
    shadow
      .querySelector("#controller")
      .addEventListener("mousedown", (e) => e.stopPropagation(), false);

    this.speedIndicator = shadow.querySelector("span");
    var fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    // specific website workarounds
    switch (true) {
      case location.hostname == "www.amazon.com":
      case location.hostname == "www.reddit.com":
      case /hbogo\./.test(location.hostname):
        // insert before parent to bypass overlay
        this.parent.parentElement.insertBefore(fragment, this.parent);
        break;
      case location.hostname == "www.facebook.com":
        // this is a monstrosity but new FB design does not have *any*
        // semantic handles for us to traverse the tree, and deep nesting
        // that we need to bubble up from to get controller to stack correctly
        let p = this.parent.parentElement.parentElement.parentElement
          .parentElement.parentElement.parentElement.parentElement;
        p.insertBefore(fragment, p.firstChild);
        break;
      case location.hostname == "tv.apple.com":
        // insert before parent to bypass overlay
        this.parent.parentNode.insertBefore(fragment, this.parent.parentNode.firstChild);
        break;
      default:
        // Note: when triggered via a MutationRecord, it's possible that the
        // target is not the immediate parent. This appends the controller as
        // the first element of the target, which may not be the parent.
        this.parent.insertBefore(fragment, this.parent.firstChild);
    }
    return wrapper;
  };
}

function escapeStringRegExp(str) {
  matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
  return str.replace(matchOperatorsRe, "\\$&");
}

function isBlacklisted() {
  blacklisted = false;
  tc.settings.blacklist.split("\n").forEach((match) => {
    match = match.replace(regStrip, "");
    if (match.length == 0) {
      return;
    }

    if (match.startsWith("/")) {
      try {
        var parts = match.split("/");

        if (regEndsWithFlags.test(match)) {
          var flags = parts.pop();
          var regex = parts.slice(1).join("/");
        } else {
          var flags = "";
          var regex = match;
        }

        var regexp = new RegExp(regex, flags);
      } catch (err) {
        return;
      }
    } else {
      var regexp = new RegExp(escapeStringRegExp(match));
    }

    if (regexp.test(location.href)) {
      blacklisted = true;
      return;
    }
  });
  return blacklisted;
}

var coolDown = false;
function refreshCoolDown() {
  log("Begin refreshCoolDown", 5);
  if (coolDown) {
    clearTimeout(coolDown);
  }
  coolDown = setTimeout(function () {
    coolDown = false;
  }, 1000);
  log("End refreshCoolDown", 5);
}

function setupListener() {
  /**
   * This function is run whenever a video speed rate change occurs.
   * It is used to update the speed that shows up in the display as well as save
   * that latest speed into the local storage.
   *
   * @param {*} video The video element to update the speed indicators for.
   */
  function updateSpeedFromEvent(video, event) {
    // It's possible to get a rate change on a VIDEO/AUDIO that doesn't have
    // a video controller attached to it.  If we do, ignore it.
    if (!video.vsc)
      return;
    var src = video.currentSrc;
    var speed = Number(video.playbackRate).toFixed(7);
    var ident = `${video.className} ${video.id} ${video.name} ${video.url} ${video.offsetWidth}x${video.offsetHeight}`;
    log("Playback rate changed to " + speed + ` for: ${ident}`, 4);
    //console.log(event);

    log("Updating controller with new speed", 5);
    video.vsc.speedIndicator.textContent = formatSpeedIndicator(speed)
    tc.settings.playersSpeed[src] = speed;
    let wasUs = event.detail && event.detail.origin === "videoSpeed";
    if (wasUs || ! tc.settings.ifSpeedIsNormalDontSaveUnlessWeSetIt || speed != 1) {

      log("Storing lastSpeed in settings for the rememberSpeed feature", 5);
      tc.settings.lastSpeed = speed;
      log("Syncing chrome settings for lastSpeed", 5);
      chrome.storage.sync.set({ lastSpeed: speed }, function () {
        log("Speed setting saved: " + speed, 5);
      });
    } else
      log(`Speed update to ${speed} ignored due to ifSpeedIsNormalDontSaveUnlessWeSetIt`,5);
    // show the controller for 1000ms if it's hidden.
    runAction("blink", null, null);
  }

  document.addEventListener(
    "ratechange",
    function (event) {
      if (coolDown) {
        log("Speed event propagation blocked", 4);
        event.stopImmediatePropagation();
      }
      var video = event.target;

      /**
       * If the last speed is forced, only update the speed based on events created by
       * video speed instead of all video speed change events.
       */
      if (tc.settings.forceLastSavedSpeed) {
        if (event.detail && event.detail.origin === "videoSpeed") {
          video.playbackRate = event.detail.speed;
          updateSpeedFromEvent(video, event);
        } else {
          video.playbackRate = tc.settings.lastSpeed;
        }
        event.stopImmediatePropagation();
      } else {
        updateSpeedFromEvent(video, event);
      }
    },
    true
  );
}

function initializeWhenReady(document) {
  log("Begin initializeWhenReady", 5);
  if (isBlacklisted()) {
    return;
  }
  window.onload = () => {
    initializeNow(window.document);
  };
  if (document) {
    if (document.readyState === "complete") {
      initializeNow(document);
    } else {
      document.onreadystatechange = () => {
        if (document.readyState === "complete") {
          initializeNow(document);
        }
      };
    }
  }
  log("End initializeWhenReady", 5);
}
function inIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}
function getShadow(parent) {
  let result = [];
  function getChild(parent) {
    if (parent.firstElementChild) {
      var child = parent.firstElementChild;
      do {
        result.push(child);
        getChild(child);
        if (child.shadowRoot) {
          result.push(getShadow(child.shadowRoot));
        }
        child = child.nextElementSibling;
      } while (child);
    }
  }
  getChild(parent);
  return result.flat(Infinity);
}

function initializeNow(document) {
  log("Begin initializeNow", 5);
  if (!tc.settings.enabled) return;
  // enforce init-once due to redundant callers
  if (!document.body || document.body.classList.contains("vsc-initialized")) {
    return;
  }
  try {
    setupListener();
  } catch {
    // no operation
  }
  document.body.classList.add("vsc-initialized");
  log("initializeNow: vsc-initialized added to document body", 5);

  if (document === window.document) {
    defineVideoController();
  } else {
    var link = document.createElement("link");
    link.href = chrome.runtime.getURL("inject.css");
    link.type = "text/css";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  var docs = Array(document);
  try {
    if (inIframe()) docs.push(window.top.document);
  } catch (e) {}

  docs.forEach(function (doc) {
    doc.addEventListener(
      "keydown",
      function (event) {
        var keyCode = event.keyCode;
        log("Processing keydown event: " + keyCode, 6);

        // Ignore if following modifier is active.
        if (
          !event.getModifierState ||
          event.getModifierState("Alt") ||
          event.getModifierState("Control") ||
          event.getModifierState("Fn") ||
          event.getModifierState("Meta") ||
          event.getModifierState("Hyper") ||
          event.getModifierState("OS")
        ) {
          log("Keydown event ignored due to active modifier: " + keyCode, 5);
          return;
        }

        // Ignore keydown event if typing in an input box
        if (
          event.target.nodeName === "INPUT" ||
          event.target.nodeName === "TEXTAREA" ||
          event.target.isContentEditable
        ) {
          return false;
        }

        // Ignore keydown event if typing in a page without vsc
        if (!tc.mediaElements.length) {
          return false;
        }

        var item = tc.settings.keyBindings.find((item) => item.key === keyCode);
        if (item) {
          runAction(item.action, item.value);
          if (item.force === "true") {
            // disable websites key bindings
            event.preventDefault();
            event.stopPropagation();
          }
        }

        return false;
      },
      true
    );
  });

  function checkForVideo(node, parent, added) {
    // Only proceed with supposed removal if node is missing from DOM
    if (!added && document.body.contains(node)) {
      return;
    }
    if (
      node.nodeName === "VIDEO" ||
      (node.nodeName === "AUDIO" && tc.settings.audioBoolean)
    ) {
      if (added) {
        node.vsc = new tc.videoController(node, parent);
      } else {
        if (node.vsc) {
          node.vsc.remove();
        }
      }
    } else if (node.children != undefined) {
      for (var i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        checkForVideo(child, child.parentNode || parent, added);
      }
    }
  }

  var observer = new MutationObserver(function (mutations) {
    // Process the DOM nodes lazily
    requestIdleCallback(
      (_) => {
        mutations.forEach(function (mutation) {
          switch (mutation.type) {
            case "childList":
              mutation.addedNodes.forEach(function (node) {
                if (typeof node === "function") return;
                if (node === document.documentElement) {
                  // This happens on sites that use document.write, e.g. watch.sling.com
                  // When the document gets replaced, we lose all event handlers, so we need to reinitialize
                  log("Document was replaced, reinitializing", 5);
                  initializeWhenReady(document);
                  return;
                }
                checkForVideo(node, node.parentNode || mutation.target, true);
              });
              mutation.removedNodes.forEach(function (node) {
                if (typeof node === "function") return;
                checkForVideo(node, node.parentNode || mutation.target, false);
              });
              break;
            case "attributes":
              if (
                (mutation.target.attributes["aria-hidden"] &&
                mutation.target.attributes["aria-hidden"].value == "false")
                || mutation.target.nodeName === 'APPLE-TV-PLUS-PLAYER'
              ) {
                var flattenedNodes = getShadow(document.body);
                var nodes = flattenedNodes.filter(
                  (x) => x.tagName == "VIDEO"
                );
                for (let node of nodes) {
                  // only add vsc the first time for the apple-tv case (the attribute change is triggered every time you click the vsc)
                  if (node.vsc && mutation.target.nodeName === 'APPLE-TV-PLUS-PLAYER')
                    continue;
                  if (node.vsc)
                    node.vsc.remove();
                  checkForVideo(node, node.parentNode || mutation.target, true);
                }
              }
              break;
          }
        });
      },
      { timeout: 1000 }
    );
  });
  observer.observe(document, {
    attributeFilter: ["aria-hidden", "data-focus-method"],
    childList: true,
    subtree: true
  });

  if (tc.settings.audioBoolean) {
    var mediaTags = document.querySelectorAll("video,audio");
  } else {
    var mediaTags = document.querySelectorAll("video");
  }

  mediaTags.forEach(function (video) {
    video.vsc = new tc.videoController(video);
  });

  var frameTags = document.getElementsByTagName("iframe");
  Array.prototype.forEach.call(frameTags, function (frame) {
    // Ignore frames we don't have permission to access (different origin).
    try {
      var childDocument = frame.contentDocument;
    } catch (e) {
      return;
    }
    initializeWhenReady(childDocument);
  });
  log("End initializeNow", 5);

  // if ( window.location.hostname.endsWith("youtube.com") )
  //   setTimeout(YTComAfterLoaded,1000);
    //eval(tc.settings.ytJS);

}

function changeSpeed(video, direction='') {
  const playbackRate = video.playbackRate.toFixed(7)
  log(`(${playbackRate})`, 4)
  for (const [idx, pair] of speedSet.entries()) {
    let [n, rate] = pair
    rate = rate.toFixed(7)
    log('+'+ idx +'='+ n +'~'+ rate +'-'+ playbackRate, 4)
    if (playbackRate === rate) {   
      log('found at:'+ idx +'='+ n +'~'+ rate +'-'+ playbackRate, 3)
      if (direction === '-') {
        setSpeed(video, speedSet[idx-1][1]);
        break;
      }
      if (direction === '+') {
        setSpeed(video, speedSet[idx+1][1]);
        break;
      }
    } else if (playbackRate < rate) {
      if (direction === '-') {
        setSpeed(video, speedSet[idx-1][1]);
        break;
      }
      if (direction === '+') {
        setSpeed(video, speedSet[idx][1]);
        break;
      }
    }
  }
}

function setSpeed(video, speed) {
  speed = Number(speed).toFixed(7);
  log(" started: " + speed, 5);
  if (tc.settings.forceLastSavedSpeed) {
    video.dispatchEvent(
      new CustomEvent("ratechange", {
        detail: { origin: "videoSpeed", speed: speed }
      })
    );
  } else {
    video.playbackRate = speed;
    log(`not forced ${speed}`)
  }
  video.vsc.speedIndicator.textContent = formatSpeedIndicator(speed)
  tc.settings.lastSpeed = speed;
  refreshCoolDown();
  log("setSpeed finished: " + speed, 5);
}

function runAction(action, value, e) {
  log("runAction Begin", 5);

  var mediaTags = tc.mediaElements;

  // Get the controller that was used if called from a button press event e
  if (e) {
    var targetController = e.target.getRootNode().host;
  }

  mediaTags.forEach(function (v) {
    var controller = v.vsc.div;

    // Don't change video speed if the video has a different controller
    if (e && !(targetController == controller)) {
      return;
    }

    showController(controller);

    if (!v.classList.contains("vsc-cancelled")) {
      if (action === "rewind") {
        log("Rewind", 5);
        v.currentTime -= value;
      } else if (action === "advance") {
        log("Fast forward", 5);
        v.currentTime += value;
      } else if (action === "faster") {
        log("Increase speed", 5);
        // Maximum playback speed in Chrome is set to 16:
        // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/media/html_media_element.cc?gsn=kMinRate&l=166
        // const s = Math.min(
        //   (v.playbackRate < 0.1 ? 0.0 : v.playbackRate) + value,
        //   16
        // );
        // setSpeed(v, s, '+');

        changeSpeed(v, '+')
      } else if (action === "slower") {
        log("Decrease speed", 5);
       // Video min rate is 0.0625:
        // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/html/media/html_media_element.cc?gsn=kMinRate&l=165
        // const s = Math.max(v.playbackRate - value, 0.07);
        // setSpeed(v, s, '-');
        changeSpeed(v, '-')
      // } else if (action === "reset") {
      //   log("Reset speed", 5);
      //   resetSpeed(v, 1.0);
      } else if (action === "display") {
        log("Showing controller", 5);
        controller.classList.add("vsc-manual");
        controller.classList.toggle("vsc-hidden");
      } else if (action === "blink") {
        log("Showing controller momentarily", 5);
        // if vsc is hidden, show it briefly to give the use visual feedback that the action is excuted.
        if (
          controller.classList.contains("vsc-hidden") ||
          controller.blinkTimeOut !== undefined
        ) {
          clearTimeout(controller.blinkTimeOut);
          controller.classList.remove("vsc-hidden");
          controller.blinkTimeOut = setTimeout(
            () => {
              controller.classList.add("vsc-hidden");
              controller.blinkTimeOut = undefined;
            },
            value ? value : 1000
          );
        }
      } else if (action === "drag") {
        handleDrag(v, e);
      // } else if (action === "fast") {
      //   resetSpeed(v, value);
      } else if (action === "pause") {
        pause(v);
      } else if (action === "muted") {
        muted(v);
      } else if (action === "mark") {
        setMark(v);
      } else if (action === "jump") {
        jumpToMark(v);
      }
    }
  });
  log("runAction End", 5);
}

function pause(v) {
  if (v.paused) {
    log("Resuming video", 5);
    v.play();
  } else {
    log("Pausing video", 5);
    v.pause();
  }
}

// function resetSpeed(v, target) {
//   if (v.playbackRate === target) {
//     if (v.playbackRate === getKeyBindings("reset")) {
//       if (target !== 1.0) {
//         log("Resetting playback speed to 1.0", 4);
//         setSpeed(v, 1.0);
//       } else {
//         log('Toggling playback speed to "fast" speed', 4);
//         setSpeed(v, getKeyBindings("fast"));
//       }
//     } else {
//       log('Toggling playback speed to "reset" speed', 4);
//       setSpeed(v, getKeyBindings("reset"));
//     }
//   } else {
//     log('Toggling playback speed to "reset" speed', 4);
//     setKeyBindings("reset", v.playbackRate);
//     setSpeed(v, target);
//   }
// }

function muted(v) {
  v.muted = v.muted !== true;
}

function setMark(v) {
  log("Adding marker", 5);
  v.vsc.mark = v.currentTime;
}
function jumpToMark(v) {
  log("Recalling marker", 5);
  if (v.vsc.mark && typeof v.vsc.mark === "number") {
    v.currentTime = v.vsc.mark;
  }
}

function handleDrag(video, e) {
  const controller = video.vsc.div;
  const shadowController = controller.shadowRoot.querySelector("#controller");

  // Find nearest parent of same size as video parent.
  var parentElement = controller.parentElement;
  while (
    parentElement.parentNode &&
    parentElement.parentNode.offsetHeight === parentElement.offsetHeight &&
    parentElement.parentNode.offsetWidth === parentElement.offsetWidth
  ) {
    parentElement = parentElement.parentNode;
  }

  video.classList.add("vcs-dragging");
  shadowController.classList.add("dragging");

  const initialMouseXY = [e.clientX, e.clientY];
  const initialControllerXY = [
    parseInt(shadowController.style.left),
    parseInt(shadowController.style.top)
  ];
  const startDragging = (e) => {
    let style = shadowController.style;
    let dx = e.clientX - initialMouseXY[0];
    let dy = e.clientY - initialMouseXY[1];
    style.left = initialControllerXY[0] + dx + "px";
    style.top = initialControllerXY[1] + dy + "px";
  };
  const stopDragging = () => {
    parentElement.removeEventListener("mousemove", startDragging);
    parentElement.removeEventListener("mouseup", stopDragging);
    parentElement.removeEventListener("mouseleave", stopDragging);

    shadowController.classList.remove("dragging");
    video.classList.remove("vcs-dragging");
  };

  parentElement.addEventListener("mouseup", stopDragging);
  parentElement.addEventListener("mouseleave", stopDragging);
  parentElement.addEventListener("mousemove", startDragging);
}

var timer = null;
function showController(controller) {
  log("Showing controller", 4);
  controller.classList.add("vcs-show");

  if (timer) clearTimeout(timer);

  timer = setTimeout(function () {
    controller.classList.remove("vcs-show");
    timer = false;
    log("Hiding controller", 5);
  }, 2000);
}

