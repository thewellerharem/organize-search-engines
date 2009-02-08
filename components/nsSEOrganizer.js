/* -*- js-standard: mozdomwindow,chromewindow,mozscript;
       js-import:../chrome/content/resize-icons.js; js-var:;              -*- */
/* ***** BEGIN LICENSE BLOCK *****
Version: MPL 1.1/GPL 2.0/LGPL 2.1

The contents of this file are subject to the Mozilla Public License Version
1.1 (the "License"); you may not use this file except in compliance with
the License. You may obtain a copy of the License at
http://www.mozilla.org/MPL/

Software distributed under the License is distributed on an "AS IS" basis,
WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
for the specific language governing rights and limitations under the
License.

The Original Code is Organize Search Engines.

The Initial Developer of the Original Code is
Malte Kraus.
Portions created by the Initial Developer are Copyright (C) 2006-2008
the Initial Developer. All Rights Reserved.

Contributor(s):
  Malte Kraus <mails@maltekraus.de> (Original author)

 Alternatively, the contents of this file may be used under the terms of
 either the GNU General Public License Version 2 or later (the "GPL"), or
 the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 in which case the provisions of the GPL or the LGPL are applicable instead
 of those above. If you wish to allow use of your version of this file only
 under the terms of either the GPL or the LGPL, and not to allow others to
 use your version of this file under the terms of the MPL, indicate your
 decision by deleting the provisions above and replace them with the notice
 and other provisions required by the GPL or the LGPL. If you do not delete
 the provisions above, a recipient may use your version of this file under
 the terms of any one of the MPL, the GPL or the LGPL.
***** END LICENSE BLOCK ***** */

const Ci = Components.interfaces, Cc = Components.classes, Cr = Components.results;
/***********************************************************
constants
***********************************************************/


// UUID uniquely identifying our component
// You can get from: http://kruithof.xs4all.nl/uuid/uuidgen here
const CLASS_ID = Components.ID("{1a6b3e72-eb74-11db-9041-00ffd1e32fc4}");
const CLASS_ID2 = Components.ID("{f2fa3794-eb73-11db-9d18-00ffd1e32fc4}");

// description
const CLASS_NAME = "For Organizing search engines in folders.";

const NS_RDF_DATASOURCE_PRE = "@mozilla.org/rdf/datasource;1?name=";
// textual unique identifier
const CONTRACT_ID = NS_RDF_DATASOURCE_PRE + "organized-internet-search-engines";
const CONTRACT_ID2 = NS_RDF_DATASOURCE_PRE + "organized-internet-search-folders";

function LOG(msg) {
  msg = "Organize Search Engines:   " + msg;
  var consoleService = Cc["@mozilla.org/consoleservice;1"]
                         .getService(Ci.nsIConsoleService);
  consoleService.logStringMessage(msg);
  //dump(msg + "\n");
  return msg;
}

function _timer(callback, timeout, type, args) {
  var obj = { notify: function() {
    return callback.apply(timer, args);
  }};
  obj.wrappedJSObject = obj;
  var timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  timer.initWithCallback(obj, timeout, type);
  return {t:timer};
}
function setTimeout(callback, timeout) {
  var args = [];
  for(var i = 2; i < arguments.length; i++)
    args.push(arguments[i]);
  return _timer(callback, timeout, Ci.nsITimer.TYPE_ONE_SHOT, args);
}
function clearTimeout(timeout) {
  var timer = timeout.t;
  timer.cancel();
  // prevent cycle references:
  timer.callback.wrappedJSObject.notify = null;
  delete timeout.t;
}
function setInterval(callback, interval) {
  var args = [];
  for(var i = 2; i < arguments.length; i++)
    args.push(arguments[i]);
  return _timer(callback, interval, Ci.nsITimer.TYPE_REPEATING_SLACK, args);
}
var clearInterval = clearTimeout;
function makeURI(aURL, aOriginCharset, aBaseURI) {
  var ioService = Cc['@mozilla.org/network/io-service;1'].getService(Ci.nsIIOService);
  return ioService.newURI(aURL, aOriginCharset, aBaseURI);
}

/*try {*/

const FILENAME = "organize-search-engines.rdf";
const UUID = "organize-search-engines@maltekraus.de";

const NS = "urn:organize-search-engines#";
const NS_RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const ROOT = "urn:organize-search-engines:root";
const FOLDERS_ROOT = "urn:organize-search-engines:folders-root";
/***********************************************************
class definition
***********************************************************/
//class constructor
function SEOrganizer() {
  this._searchService = Cc["@mozilla.org/browser/search-service;1"]
                          .getService(Ci.nsIBrowserSearchService);
  this._rdfService = Cc["@mozilla.org/rdf/rdf-service;1"]
                       .getService(Ci.nsIRDFService);
  this.wrappedJSObject = this;
  this._init();
}

// class definition
SEOrganizer.prototype = {
  wrappedJSObject: null,
  indexOutOfDate: true,
  _init: function SEOrganizer___init() {
    this._datasource = this._rdfService.GetDataSourceBlocking(this._saveURI);
    this._datasource.QueryInterface(Ci.nsIRDFRemoteDataSource);

    var os = Cc["@mozilla.org/observer-service;1"]
               .getService(Ci.nsIObserverService);
    os.addObserver(this, "browser-search-engine-modified", false);

    // call *both* and save if at least one returned true
    if(this._removeNonExisting() | this._addMissingEnginesToRDF())
      this.saveChanges();

    this._modifySearchService();

    this._createMultiEngine();
  },

  saveChanges: function SEOrganizer__saveChanges(dontResort) {
    this.Flush();

    if(!dontResort) {
      // tell the normal search service the right order
      // but we do it with some delays so we don't block the UI thread for ages
      if(this.indexOutOfDate)
        this._updateIndexCache();
      var instance = this;
      var os = Cc["@mozilla.org/observer-service;1"]
                 .getService(Ci.nsIObserverService);
      try {
        os.removeObserver(this, "browser-search-engine-modified");
        var addObserver = true;
      } catch(e) {
        var addObserver = false;
      }
      var hiddenInTemplate = false;
      var engines = [];
      for(var i = 0; i < this._indexCache.length; ++i) {
        if(!this.isFolder(this._indexCache[i]) &&
           !this.isSeparator(this._indexCache[i])) {
          var name = this.getNameByItem(this._indexCache[i]);
          var engine = this.getEngineByName(name);
          if(engine instanceof Ci.nsISearchEngine && !engine.hidden) {
            engines.push(engine);
          } else {
            hiddenInTemplate = true;
          }
        }
      }
      setTimeout(this.__delayedMoveEngines, 0, 0, engines, this);
      if(hiddenInTemplate) {
        this._removeNonExisting();
        this.notifyObservers();
        this.saveChanges();
      }
      if(addObserver) {
        os.addObserver(instance, "browser-search-engine-modified", false);
      }
    }
  },
  __delayedMoveEngines: function delayedMoveEngines(i, engines, This) {
    if(engines.length <= i)
      return;
    for(var j = i; j < engines.length && j < i + 10; j++)
      This.moveEngine(engines[j], j);
    setTimeout(delayedMoveEngines, 30, j, engines, This);
  },

  reload: function SEOrganizer__reload() {
    //this.Refresh(true); // crashes when there is an empty folder
    this.beginUpdateBatch();
    this._datasource = this._rdfService.GetDataSourceBlocking(this._saveURI)
                           .QueryInterface(Ci.nsIRDFRemoteDataSource);
    for(var i = 0; i < this._observers.length; ++i) {
      this._datasource.AddObserver(this._observers[i]);
    }
    this.indexOutOfDate = true;
    this._addMissingEnginesToRDF();
    this._removeNonExisting();
    this.endUpdateBatch();

    this.notifyObservers();
  },

  _engineFolders: {},
  // check if every installed (and visible) engine is in the rdf
  _addMissingEnginesToRDF: function addMissing(save) {
    var rdfService = this._rdfService;
    var rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                              .getService(Ci.nsIRDFContainerUtils);
    var searchService = this._searchService;

    var root = rdfService.GetResource(ROOT);
    var rootContainer = rdfContainerUtils.MakeSeq(this, root);
    var name = rdfService.GetResource(NS + "Name");
    var engines = searchService.getVisibleEngines({});

    var container, parent;
    var modified = false;
    for(var i = 0; i < engines.length; ++i) {
      if(!this.itemWithNameExists(engines[i].name)) {
        container = null;
        if(engines[i].name.replace(/\s+$/g, "") in this._engineFolders) {
          var parent = this._engineFolders[engines[i].name];
          if(parent == FOLDERS_ROOT)
            parent = ROOT;
          try {
            parent = rdfService.GetResource(parent);
            delete this._engineFolders[engines[i].name];
            container = Cc["@mozilla.org/rdf/container;1"]
                          .createInstance(Ci.nsIRDFContainer);
            container.Init(this, parent);
          } catch(e) { }
        }
        try {
          var current = this._getAnonymousResource();
          (container || rootContainer).AppendElement(current);
          var currentName = rdfService.GetLiteral(engines[i].name);
          this.Assert(current, name, currentName, true);
          modified = true;
        } catch(e) {}
      }
    }
    if(modified) {
      this.indexOutOfDate = true;
      if(save)
        this.saveChanges(true);
    }
    return modified;
  },
  // remove engines from the rdf that do not exist (anymore)
  _removeNonExisting: function removeNonExisting(save) {
    var modified = false;
    var resources = this.GetAllResources();
    var name = this._rdfService.GetResource(NS + "Name");
    while(resources.hasMoreElements()) {
      try {
        var item = resources.getNext().QueryInterface(Ci.nsIRDFResource);
        if(item.Value != ROOT && this.hasArcOut(item, name)) {
          var isEngine = !this.isFolder(item); // it has a name property, so can't be a separator
          var engineName = this.getNameByItem(item);
          var engine = this.getEngineByName(engineName);
          if((isEngine && (!engine || engine.hidden)) ||
             !this.ArcLabelsIn(item).hasMoreElements()) {
            this._internalRemove(item);
            modified = true;
          }
        }
      } catch(e) { }
    }
    if(save && modified)
      this.saveChanges(true);
    return modified;
  },


  _modifySearchService: function() {
    var topLevel = this.defaultEngine.wrappedJSObject.__parent__;
    var uri = "chrome://seorganizer/content/searchServiceModifications.js";
    Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader)
                                               .loadSubScript(uri, topLevel);
  },

  _createMultiEngine: function() {
    var prefs = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch);
    const CUR_ENGINE_PREF = "browser.search.selectedEngine";
    if(prefs.getPrefType(CUR_ENGINE_PREF) == Ci.nsIPrefBranch.PREF_STRING) {
      var curEngine = prefs.getComplexValue(CUR_ENGINE_PREF, Ci.nsISupportsString).data
      if(this.currentEngine.name != curEngine && !this.getEngineByName(curEngine)) {
        var item = this.getItemByName(curEngine);
        if(item && this.isFolder(item)) {
          this.currentEngine = this.folderToEngine(item);
        }
      }
    }
  },

  observe: function observe(aEngine, aTopic, aVerb) {
    if(aTopic == "browser-search-engine-modified") {
      switch(aVerb) {
        case "engine-removed":
          this.beginUpdateBatch();
          if(this._removeNonExisting(true)) {
            this.notifyObservers();
          }
          this.endUpdateBatch();
          break;
        case "engine-added":
          this.beginUpdateBatch();
          if(this._addMissingEnginesToRDF(true)) {
            this.notifyObservers();
          }
          this.endUpdateBatch();
          break;
        case "engine-changed":
          // An engine was hidden, unhidden, moved, renamed, updated or an icon
          // changed.  We have to remove or add it from/to the RDF when it was
          // hidden/unhidden (this doesn't call removed/added).
          if(aEngine.wrappedJSObject.__action == "hidden") {
            if(aEngine.hidden)
              this.observe(aEngine, aTopic, "engine-removed");
            else
              this.observe(aEngine, aTopic, "engine-added");
          }
        case "engine-current": // The current engine was changed.
          var engines = this.getVisibleEngines({});
          for(var i = 0; i < engines.length; i++) {
            if("innerEngines" in engines[i].wrappedJSObject &&
               engines[i].name != aEngine.name)
              this.removeEngine(engines[i]);
          }
          break;
        case "engine-loaded": // An engine's/icon's download was completed.
          break;
      }
      // xxx we should notify rdf observers
    }
  },

  notifyObservers: function() {
    var os = Cc["@mozilla.org/observer-service;1"]
               .getService(Ci.nsIObserverService);
    os.notifyObservers(null, "browser-search-engine-modified", "-engines-organized");
  },

  isFolder: function SEOrganizer__isFolder(aResource) {
    const rdfService = this._rdfService;
    return this.HasAssertion(aResource, rdfService.GetResource(NS_RDF + "instanceOf"),
                             rdfService.GetResource(NS_RDF + "Seq"), true);
  },
  newFolder: function SEOrganizer__newFolder(aFolderName, aParentFolder) {
    const rdfService = this._rdfService;
    const rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                                .getService(Ci.nsIRDFContainerUtils);

    if(!aParentFolder || !(aParentFolder instanceof Ci.nsIRDFResource))
      aParentFolder = this.getRoot();
    var parentFolder = Cc["@mozilla.org/rdf/container;1"]
                         .createInstance(Ci.nsIRDFContainer);
    parentFolder.Init(this, aParentFolder);

    var name = rdfService.GetResource(NS + "Name");
    var folderName = rdfService.GetLiteral(aFolderName);
    var folder = this._getAnonymousResource();
    this.Assert(folder, name, folderName, true);
    var container = rdfContainerUtils.MakeSeq(this, folder);
    parentFolder.AppendElement(folder);

    return folder;
  },

  isSeparator: function SEOrganizer__isSeparator(aResource) {
    const rdfService = this._rdfService;
    return this.HasAssertion(aResource, rdfService.GetResource(NS_RDF + "type"),
                             rdfService.GetResource(NS + "separator"), true);
  },
  newSeparator: function SEOrganizer__newSeparator(aParentFolder) {
    const rdfService = this._rdfService;
    const rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                                .getService(Ci.nsIRDFContainerUtils);

    if(!aParentFolder || !(aParentFolder instanceof Ci.nsIRDFResource))
      aParentFolder = this.getRoot();
    var parentFolder = rdfContainerUtils.MakeSeq(this, aParentFolder);

    var type = rdfService.GetResource(NS_RDF + "type");
    var separatorType = rdfService.GetResource(NS + "separator");
    var separator = this._getAnonymousResource();
    parentFolder.AppendElement(separator);
    this.Assert(separator, type, separatorType, true);

    return separator;
  },

  removeItem: function SEOrganizer__removeItem(aItem, aRecurse) {
    var toRemove = [aItem];

    if(this.isFolder(aItem) && aRecurse) { // find (grand-)children of this folder and remove them as well
      const rdfService = this._rdfService;
      const rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                                  .getService(Ci.nsIRDFContainerUtils);
      var container = Cc["@mozilla.org/rdf/container;1"]
                        .createInstance(Ci.nsIRDFContainer);
      container.Init(this, aItem);
      var containers = [{node: aItem, count: container.GetCount()}];
      for(var i = 0; i < containers.length; i++) {
        for(var j = 1; j <= containers[i].count; j++) {
          var item = this.GetTarget(containers[i].node,
                                    rdfService.GetResource(NS_RDF + "_" + j), true);
          toRemove.push(item);
          if(this.isFolder(item))
            containers.push({node: item, count: container.Init(this, item).GetCount()});
        }
      }
    }

    for(var i = 0; i < toRemove.length; ++i) {
      // remove the underlying search engine file using the search service
      var name = this.getNameByItem(toRemove[i]);
      if(name) { // this may be a separator
        var engine = this.getEngineByName(name);
        if(engine && engine instanceof Ci.nsISearchEngine) {
          this.removeEngine(engine);
          continue; // our observers already call _internalRemove!
        }
      }
      this._internalRemove(toRemove[i]);
    }
  },
  _internalRemove: function(aItem) { /* wipe aItem from the rdf tree */
    // remove everything this item does reference to
    var predicates = this.ArcLabelsIn(aItem), parent, pred;
    while(predicates.hasMoreElements()) {
      pred = predicates.getNext();
      parent = this.GetSources(pred, aItem, true);
      while(parent.hasMoreElements()) {
        this.Unassert(parent.getNext(), pred, aItem, true);
      }
    }
    // remove all references to this item
    var predicates = this.ArcLabelsOut(aItem), object;
    while(predicates.hasMoreElements()) {
      pred = predicates.getNext();
      object = this.GetTargets(aItem, pred, true);
      while(object.hasMoreElements()) {
        this.Unassert(aItem, pred, object.getNext(), true);
      }
    }
    this.indexOutOfDate = true;
  },

  getRoot: function SEOrganizer__getRoot() {
    return this._rdfService.GetResource(ROOT);
  },
  itemWithNameExists: function SEOrganizer__itemExists(aName) {
    if(!aName)
      return false;

    const rdfService = this._rdfService;
    var predicate = rdfService.GetResource(NS + "Name");
    var object = rdfService.GetLiteral(aName);
    if(this.hasArcIn(object, predicate)) {
      var ids = this.GetSources(predicate, object, true);
      while(ids.hasMoreElements()) {
        var id = ids.getNext();
        if(this.ArcLabelsIn(id).hasMoreElements()) {
          return true;
        }
      }
    }
    return false;
  },
  getNameByItem: function SEOrganizer__getNameByItem(aItem) {
    const rdfService = this._rdfService;
    var name = this.GetTarget(aItem, rdfService.GetResource(NS + "Name"), true);
    if(name instanceof Ci.nsIRDFLiteral)
      return name.Value;
    return "";
  },
  getIconByIndex: function SEOrganizer__getIconByIndex(aIndex) {
    if(aIndex != -1) {
      var predicate = this._rdfService.GetResource(NS + "Icon");
      var item = this.getItemByIndex(aIndex);

      var icon = this.GetTarget(item, predicate, true);
      if(icon instanceof Ci.nsIRDFLiteral)
        return icon.ValueUTF8;
    }
    return "";
  },
  getItemByName: function SEOrganizer__getItemByName(aName) {
    const rdfService = this._rdfService;
    return this.GetSource(rdfService.GetResource(NS + "Name"),
                          rdfService.GetLiteral(aName), true);
  },

  getParent: function SEOrganizer__getParent(aItem) {
    var predicates = this.ArcLabelsIn(aItem);
    if(predicates.hasMoreElements()) {
      return this.GetSource(predicates.getNext(), aItem, true);
    }
    return null;
  },

  _indexCache: [],
  getItemByIndex: function SEOrganizer__getItemByIndex(aIndex) {
    if(this.indexOutOfDate)
      this._updateIndexCache();
    if(this._indexCache.hasOwnProperty(aIndex))
      return this._indexCache[aIndex];
    return null;
  },
  _updateIndexCache: function _updateIndexCache() {
    if(this._updateBatchRunning)
      return;

    var cache = [];
    cache[-1] = this.getRoot();

    var count = 0;
    function callback(current) {
      cache[count++] = current;
      return false;
    }
    try {
      this._iterateAll(callback, this._iterateAllCallback_FilterNothing);
    } catch(e) { }
    this.indexOutOfDate = false;
    return this._indexCache = cache;
  },
  indexOf: function SEOrganizer__indexOf(aItem, aGlobal) {
    if(aGlobal) {
      if(this.indexOutOfDate)
        this._updateIndexCache();
      return this._indexCache.indexOf(aItem);
    } else {
      var parent = this.getParent(aItem);
      var container = Cc["@mozilla.org/rdf/container;1"]
                        .createInstance(Ci.nsIRDFContainer);
      container.Init(this, parent);
      return container.IndexOf(aItem);
    }
  },
  getChildCount: function SEOrganizer__getChildCount(aItem) {
    const rdfService = this._rdfService;
    const rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                                .getService(Ci.nsIRDFContainerUtils);

    var container = Cc["@mozilla.org/rdf/container;1"]
                      .createInstance(Ci.nsIRDFContainer);
    container.Init(this, aItem);

    var count = container.GetCount();
    // find grandchildren:
    var containers = [container];
    for(var i = 0; i < containers.length; ++i) {
      var elems = containers[i].GetElements();
      while(elems.hasMoreElements()) {
        var elem = elems.getNext();
        if(this.isFolder(elem)) {
          container = rdfContainerUtils.MakeSeq(this, elem);
          containers.push(container);
          count += container.GetCount();
        }
      }
    }

    return count;
  },

  _iterateAllDefaultCallback: function callback(aNode) {
    return !(this.isFolder(aNode) || this.isSeparator(aNode));
  },
  _iterateAllCallback_FilterNothing: function callback(aNode) {
    return true;
  },
  _iterateAllCallback_FilterSeparators: function callback(aNode) {
    return !this.isSeparator(aNode);
  },
  /**
   * Iterates through all items and calls a callback function for each.
   *
   * @param callback The function to call.
   * @param filter   Optionally defines a function that is called before calling
   *                 callback. If filter returns false, the callback does not
   *                 get called. The default filters any folders and separators.
   *
   * @return false if abort exception is thrown, otherwise true.
   */
  _iterateAll: function iterateAll(aCallback, aFilter, aRoot) {
    const rdfService = this._rdfService;
    const rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                                .getService(Ci.nsIRDFContainerUtils);

    if(!aFilter)
      aFilter = this._iterateAllDefaultCallback;

    var root = aRoot || rdfService.GetResource(ROOT);
    var rootContainer = rdfContainerUtils.MakeSeq(this, root);
    var name = rdfService.GetResource(NS + "Name");

    function Enumerator(nsISimpleEnumerator) {
      var arr = [];
      while(nsISimpleEnumerator.hasMoreElements()) {
        arr.push(nsISimpleEnumerator.getNext());
      }
      arr.reverse();
      return arr;
    }

    // recursion would be much simpler but it's better avoided
    var children = [], last;
    children.push(new Enumerator(rootContainer.GetElements()));
    while(children.length) {
      last = children.length - 1;
      while(children[last].length) {
        var l = children[last].length - 1;
        var current = children[last][l].QueryInterface(Ci.nsIRDFResource);

        try {
          if(aFilter.call(this, current))
            aCallback.call(this, current, children[last]);
        } catch(e) {
          if(!(e instanceof Error))
            throw e;

          switch(e.message) {
            case "_iterateAll::succeeded": return true;
            case "_iterateAll::abort": return false;
            default: throw e;
          }
        }
        children[last] = children[last].slice(0, l);

        if(this.isFolder(current)) {
          var seq = rdfContainerUtils.MakeSeq(this, current);
          children.push(new Enumerator(seq.GetElements()));
          ++last;
        }
      }
      children = children.slice(0, last);
    }

    return true;
  },

  folderToEngine: function(folder) {
    var ss = this._searchService.wrappedJSObject;
    var name = this.getNameByItem(folder);
    var engine = ss.getEngineByName(name);
    if(!engine) {
      engine = {
        alias: "", searchForm: "",
        hidden: false, _remove: function() {},
        iconURI: null, iconURL: "",
        name: name,
        type: 4,
        addParam: function() { throw Cr.NS_ERROR_FAILURE },
        _file: { parent: {path: "[fake]/" + name + ".xml" }},
        _serializeToJSON: function() {return ""},
        getSubmission: function(data, type) {
          var i = -1;
          var submission = {
            getNext: function() {
              i++;
              var submission = engine.innerEngines[i].getSubmission(data, type);
              return submission;
            },
            hasMoreElements: function() { return i + 1 < engine.innerEngines.length; },
            QueryInterface: function(aIID) {
              if(aIID.equals(Ci.nsISupports) || aIID.equals(Ci.nsISimpleEnumerator) ||
                 aIID.equals(Ci.nsISearchSubmission))
                return this;
              throw Cr.NS_ERROR_NO_INTERFACE;
            }
          };

          var first = submission.getNext();
          submission.postData = first.postData;
          submission.uri = first.uri;

          return submission;
        },
        innerEngines: [],
        supportsResponseType: function(type) {
          return (type == null || type == "text/html");
        },
        QueryInterface: function(aIID) {
          if(aIID.equals(Ci.nsISupports) || aIID.equals(Ci.nsISearchEngine))
            return this;
          throw Cr.NS_ERROR_NO_INTERFACE;
        }
      };
      engine.wrappedJSObject = engine;
      this._iterateAll(function(item) {
        engine.innerEngines.push(this.getEngineByName(this.getNameByItem(item)));
      }, null, folder);

      if(!engine.innerEngines.length)
        throw Cr.NS_ERROR_FAILURE;
      if(engine.innerEngines.length == 1)
        return engine.innerEngines[0];

      if(typeof Resizer == "undefined") {
         Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader)
           .loadSubScript("chrome://seorganizer/content/resize-icons.js");
      }
      var resizer = new Resizer(16, 16);
      resizer.onload = function iconLoadCallback() {
        resizer.paintIcons();
        engine.iconURI = makeURI(resizer.getDataURL());
        engine.iconURL = engine.iconURI.spec;
        engine.__action = "icon";
        ss.__parent__.notifyAction(engine, "engine-changed");
        resizer = null;
      };
      for(var i = 0; i < engine.innerEngines.length; i++) {
        resizer.addIconByURL(engine.innerEngines[i].iconURI.spec);
      }
      ss._addEngineToStore(engine);
    }
    return engine;
  },

  // I know of at least one case, where an id was used twice, so we're making
  // sure here, this won't happen again in future
  _getAnonymousResource: function() {
    var ano = "", rdf = this._rdfService;
    do {
      ano = rdf.GetAnonymousResource();
    } while(this.ArcLabelsIn(ano).hasMoreElements() ||
            this.ArcLabelsOut(ano).hasMoreElements());
    return ano;
  },

  get _saveFile() {
    var file = Cc["@mozilla.org/file/directory_service;1"]
                 .getService(Ci.nsIProperties).get("ProfD", Ci.nsIFile);
    file.append(FILENAME);
    return file;
  },
  get _saveURI() {
    var fileProtocolHandler = Cc["@mozilla.org/network/protocol;1?name=file"]
                                .getService(Ci.nsIFileProtocolHandler);
    return fileProtocolHandler.getURLSpecFromFile(this._saveFile);
  },
  _rdfService: null,
  _datasource: null,
  _searchService: null,

  /* nsIBrowserSearchService */
  addEngine: function nsIBrowserSearchService__addEngine(engineURL, type, iconURL) {
    return this._searchService.addEngine(engineURL, type, iconURL);
  },
  addEngineWithDetails: function nsIBrowserSearchService__addEngineWithDetails(name, iconURL, alias, description, method, url) {
    return this._searchService.addEngine(name, iconURL, alias, description, method, url);
  },
  restoreDefaultEngines: function nsIBrowserSearchService__restoreDefaultEngines() {
    return this._searchService.restoreDefaultEngines();
  },
  getDefaultEngines: function nsIBrowserSearchService__getDefaultEngines(num) {
    return this._searchService.getDefaultEngines(num);
  },
  getEngineByAlias: function nsIBrowserSearchService__getEngineByAlias(alias) {
    return this._searchService.getEngineByAlias(alias);
  },
  getEngineByName: function nsIBrowserSearchService__getEngineByName(name) {
    return this._searchService.getEngineByName(name);
  },
  getEngines: function nsIBrowserSearchService__getEngines(engineCount) {
    return this._searchService.getEngines(engineCount);
  },
  getVisibleEngines: function nsIBrowserSearchService__getVisibleEngines(engineCount) {
    return this._searchService.getVisibleEngines(engineCount);
  },
  moveEngine: function nsIBrowserSearchService__moveEngine(engine, newIndex) {
    try {
      return this._searchService.moveEngine(engine, newIndex);
    } catch(e) {
      throw e.code;
    }
  },
  removeEngine: function nsIBrowserSearchService__removeEngine(engine) {
    return this._searchService.removeEngine(engine);
  },
  _defaultEngine: null,
  get defaultEngine() {
    if(!this._defaultEngine)
      this._defaultEngine = this._searchService.defaultEngine;
    return this._defaultEngine;
  },
  get currentEngine() {
    return this._searchService.currentEngine;
  },
  set currentEngine(aEngine) {
    return this._searchService.currentEngine = aEngine;
  },

  /* nsIRDFRemoteDataSource */
  get loaded() {
    return this._datasource.loaded;
  },
  Init: function nsIRDFRemoteDataSource__Init(URI) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    //this._datasource.Init(URI);
  },
  Flush: function nsIRDFRemoteDataSource__Flush() {
    this._datasource.Flush();
  },
  FlushTo: function nsIRDFRemoteDataSource__FlushTo(URI) {
    this._datasource.FlushTo(URI);
  },
  Refresh: function nsIRDFRemoteDataSource__Refresh(blocking) {
    //this._datasource.Refresh(blocking);
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  /* nsIRDFDataSource */
  get URI() {
    return this._datasource.URI;
  },
  _observers: [],
  AddObserver: function nsIRDFDataSource__AddObserver(observer) {
    this._observers.push(observer);
    return this._datasource.AddObserver(observer)
  },
  ArcLabelsIn: function nsIRDFDataSource__ArcLabelsIn(node) {
    return this._datasource.ArcLabelsIn(node);
  },
  ArcLabelsOut: function nsIRDFDataSource__ArcLabelsOut(node) {
    return this._datasource.ArcLabelsOut(node);
  },
  Assert: function nsIRDFDataSource__Assert(source, property, target, truthValue) {
    var ret = this._datasource.Assert(source, property, target, truthValue);
    this.indexOutOfDate = true;
    return ret;
  },
  _updateBatchRunning: false,
  beginUpdateBatch: function nsIRDFDataSource__beginUpdateBatch() {
    this._updateBatchRunning = true;
    return this._datasource.beginUpdateBatch();
  },
  Change: function nsIRDFDataSouce__Change(source, property, oldTarget, newTarget) {
    return this._datasource.Change(source, property, oldTarget, newTarget);
  },
  DoCommand: function nsIRDFDataSouce__DoCommand(sources, command, arguments) {
    return this._datasource.DoCommand(sources, command, arguments);
  },
  endUpdateBatch: function nsIRDFDataSouce__endUpdateBatch() {
    this._updateBatchRunning = false;
    
    return this._datasource.endUpdateBatch();
  },
  GetAllCmds: function nsIRDFDataSource__GetAllCmds(source) {
    return this._datasource.GetAllCmds(source);
  },
  GetAllResources: function nsIRDFDataSource__GetAllResources() {
    return this._datasource.GetAllResources();
  },
  GetSource: function nsIRDFDataSource__GetSource(property, target, truthValue) {
    return this._datasource.GetSource(property, target, truthValue);
  },
  GetSources: function nsIRDFDataSource__GetSources(property, target, truthValue) {
    return this._datasource.GetSources(property, target, truthValue);
  },
  GetTarget: function nsIRDFDataSource__GetTarget(source, property, truthValue) {
    if(property.QueryInterface(Ci.nsIRDFResource).ValueUTF8 === NS + "Icon" &&
       !this.isFolder(source) && !this.isSeparator(source) && truthValue) {
      var name = this.getNameByItem(source);
      var engine = this.getEngineByName(name);
      if(engine && engine.iconURI)
        return this._rdfService.GetLiteral(engine.iconURI.spec);
    } else if(property.ValueUTF8 === NS + "Selected" &&
              !this.isSeparator(source) && truthValue) {
      try {
        var name = this.currentEngine.name;
        var found = (name == this.getNameByItem(source));
        if(!found && this.isFolder(source)) {
          this._iterateAll(function find(item) {
            if(this.getNameByItem(item) == name) {
              found = true;
              throw new Error("_iterateAll::succeeded");
            }
          }, null, source);
        }
      } catch(e) { }
      return this._rdfService.GetLiteral(found.toString());
    } else if(property.Value == NS + "Name" && this.isSeparator(source)
              && truthValue) {
      try { // make the built-in sorting mechanism work
        var parent = Cc["@mozilla.org/rdf/container;1"]
                       .createInstance(Ci.nsIRDFContainer);
        parent.Init(this, this.getParent(source));
        var idx = parent.IndexOf(source);
        if(idx == -1 || idx == 0) {
          return this._rdfService.GetLiteral("");
        } else {
          var contUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                            .getService(Ci.nsIRDFContainerUtils);
          var arc = contUtils.IndexToOrdinalResource(idx - 1);
          var prevItem = this._datasource.GetTarget(parent.Resource, arc, true);
          var prevName = this.GetTarget(prevItem, property, true);
          if(!(prevName instanceof Ci.nsIRDFLiteral)) // separator is at top
            return this._rdfService.GetLiteral("\0\0\0\0\0\0\0\0\0\0\0\0\0\0"); // bah!
          return this._rdfService.GetLiteral(prevName.Value + "ZZZZZZZZZZZZZZ");
        }
      } catch(e) {
        return this._rdfService.GetLiteral("");
      }
    }
    try {
      return this._datasource.GetTarget(source, property, truthValue);
    } catch(e) {
      throw Cr.NS_ERROR_INVALID_ARG;
    }
  },
  GetTargets: function nsIRDFDataSource__GetTargets(source, property, truthValue) {
    return this._datasource.GetTargets(source, property, truthValue);
  },
  hasArcIn: function nsIRDFDataSource__hasArcIn(node, arc) {
    return this._datasource.hasArcIn(node, arc);
  },
  hasArcOut: function nsIRDFDataSource__hasArcOut(source, arc) {
    return this._datasource.hasArcOut(source, arc);
  },
  HasAssertion: function nsIRDFDataSource__HasAssertion(source, property, target, truthValue) {
    return this._datasource.HasAssertion(source, property, target, truthValue);
  },
  IsCommandEnabled: function nsIRDFDataSource__IsCommandEnabled(sources, command, arguments) {
    return this._datasource.IsCommandEnabled(sources, command, arguments);
  },
  Move: function nsIRDFDataSource__Move(oldSource, newSource, property, target) {
    var ret = this._datasource.Move(oldSource, newSource, property, target);
    this.indexOutOfDate = true;
    return ret;
  },
  RemoveObserver: function nsIRDFDataSource__RemoveObserver(observer) {
    var obs = this._observers;
    var index = obs.indexOf(observer);
    if(index != -1)
      this._observers.splice(index, 1);
    return this._datasource.RemoveObserver(observer);
  },
  Unassert: function nsIRDFDataSource__Unassert(source, property, target) {
    var ret = this._datasource.Unassert(source, property, target);
    this.indexOutOfDate = true;
    return ret;
  },

  QueryInterface: function QueryInterface(aIID) {
    if(aIID.equals(Ci.nsISupports) || aIID.equals(Ci.nsIRDFDataSource) ||
       aIID.equals(Ci.nsISEOrganizer) || aIID.equals(Ci.nsIBrowserSearchService) ||
       aIID.equals(Ci.nsIObserver)) {
      return this;
    } else {
      throw Cr.NS_ERROR_NO_INTERFACE;
    }
  }
};

function FoldersOnly() {
  var datasource = Cc["@mozilla.org/rdf/datasource;1?name=in-memory-datasource"]
                     .createInstance(Ci.nsIRDFInMemoryDataSource)
                     .QueryInterface(Ci.nsIRDFDataSource);
  this._datasource = datasource;

  this._update();

  var os = Cc["@mozilla.org/observer-service;1"]
            .getService(Ci.nsIObserverService);
  os.addObserver(this, "browser-search-engine-modified", false);
}
FoldersOnly.prototype = {
  _datasource: null,

  _update: function() {
    this.beginUpdateBatch();
    var datasource = this._datasource;
    var rdfService = Cc["@mozilla.org/rdf/rdf-service;1"]
                         .getService(Ci.nsIRDFService);
    var rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                              .getService(Ci.nsIRDFContainerUtils);
    var seOrganizer = Cc[CONTRACT_ID].getService(Ci.nsISEOrganizer).wrappedJSObject;

    var root = rdfService.GetResource(FOLDERS_ROOT);
    var rootContainer = rdfContainerUtils.MakeSeq(datasource, root);

    // clean up old stuff
    var elements = rootContainer.GetElements(), hasMore = elements.hasMoreElements();
    while(hasMore) // only renumber once
      rootContainer.RemoveElement(elements.getNext(), !(hasMore = elements.hasMoreElements()));

    try {
      var item = seOrganizer.getItemByIndex(0), i = 0;
      while(item) {
        if(seOrganizer.isFolder(item)) {
          rootContainer.AppendElement(item);
        }
        if(++i < seOrganizer._indexCache.length) {
          item = seOrganizer.getItemByIndex(i);
        } else {
          break;
        }
      }
    } catch(e) {}
    this.endUpdateBatch();
  },
  observe: function(aEngine, aTopic, aVerb) {
    if(aTopic == "browser-search-engine-modified" && aVerb == "-engines-organized") {
      this._update();
    }
  },
  get URI() {
    return this._datasource.URI;
  },
  AddObserver: function nsIRDFDataSource__AddObserver(observer) {
    return this._datasource.AddObserver(observer);
  },
  ArcLabelsIn: function nsIRDFDataSource__ArcLabelsIn(node) {
    return this._datasource.ArcLabelsIn(node);
  },
  ArcLabelsOut: function nsIRDFDataSource__ArcLabelsOut(node) {
    return this._datasource.ArcLabelsOut(node);
  },
  Assert: function nsIRDFDataSource__Assert(source, property, target, truthValue) {
    //throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    return this._datasource.Assert(source, property, target, truthValue);
  },
  beginUpdateBatch: function nsIRDFDataSource__beginUpdateBatch() {
    return this._datasource.beginUpdateBatch();
  },
  Change: function nsIRDFDataSouce__Change(source, property, oldTarget, newTarget) {
    //throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    return this._datasource.Change(source, property, oldTarget, newTarget);
  },
  DoCommand: function nsIRDFDataSouce__DoCommand(sources, command, arguments) {
    return this._datasource.DoCommand(sources, command, arguments);
  },
  endUpdateBatch: function nsIRDFDataSouce__endUpdateBatch() {
    return this._datasource.endUpdateBatch();
  },
  GetAllCmds: function nsIRDFDataSource__GetAllCmds(source) {
    return this._datasource.GetAllCmds(source);
  },
  GetAllResources: function nsIRDFDataSource__GetAllResources() {
    return this._datasource.GetAllResource();
  },
  GetSource: function nsIRDFDataSource__GetSource(property, target, truthValue) {
    return this._datasource.GetSource(property, target, truthValue);
  },
  GetSources: function nsIRDFDataSource__GetSources(property, target, truthValue) {
    return this._datasource.GetSources(property, target, truthValue);
  },
  GetTarget: function nsIRDFDataSource__GetTarget(source, property, truthValue) {
    try {
      return this._datasource.GetTarget(source, property, truthValue);
    } catch(e) {
      throw Cr.NS_ERROR_INVALID_ARG;
    }
  },
  GetTargets: function nsIRDFDataSource__GetTargets(source, property, truthValue) {
    return this._datasource.GetTargets(source, property, truthValue);
  },
  hasArcIn: function nsIRDFDataSource__hasArcIn(node, arc) {
    return this._datasource.hasArcIn(node, arc);
  },
  hasArcOut: function nsIRDFDataSource__hasArcOut(source, arc) {
    return this._datasource.hasArcOut(source, arc);
  },
  HasAssertion: function nsIRDFDataSource__HasAssertion(source, property, target, truthValue) {
    return this._datasource.HasAssertion(source, property, target, truthValue);
  },
  IsCommandEnabled: function nsIRDFDataSource__IsCommandEnabled(sources, command, arguments) {
    return this._datasource.IsCommandEnabled(sources, command, arguments);
  },
  Move: function nsIRDFDataSource__Move(oldSource, newSource, property, target) {
    //throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    return this._datasource.Move(oldSource, newSource, property, target);
  },
  RemoveObserver: function nsIRDFDataSource__RemoveObserver(observer) {
    return this._datasource.RemoveObserver(observer);
  },
  Unassert: function nsIRDFDataSource__Unassert(source, property, target) {
    //throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    return this._datasource.Unassert(source, property, target);
  },

  QueryInterface: function QueryInterface(aIID) {
    if(aIID.equals(Ci.nsISupports) || aIID.equals(Ci.nsIRDFDataSource) ||
       aIID.equals(Ci.nsIObserver))
      return this;
    throw Cr.NS_ERROR_NO_INTERFACE;
  }
};
/*} catch(e) {
  Components.reportError(e);
}*/

/***********************************************************
class factory

This object is a member of the global-scope Components.classes.
It is keyed off of the contract ID. Eg:

myHelloWorld = Cc["@dietrich.ganx4.com/helloworld;1"].
                          createInstance(Ci.nsISEOrganizer);

***********************************************************/
var SEOrganizerFactory = {
  createInstance: function (aOuter, aIID) {
    if(aOuter !== null)
      throw Cr.NS_ERROR_NO_AGGREGATION;

    return (new SEOrganizer()).QueryInterface(aIID);
  }
};
var FolderFactory = {
  createInstance: function (aOuter, aIID) {
    if(aOuter !== null)
      throw Cr.NS_ERROR_NO_AGGREGATION;

    return (new FoldersOnly()).QueryInterface(aIID);
  }
};

/***********************************************************
module definition (xpcom registration)
***********************************************************/
var SEOrganizerModule = {
  registerSelf: function(aCompMgr, aFileSpec, aLocation, aType) {
    aCompMgr = aCompMgr.QueryInterface(Ci.nsIComponentRegistrar);
    aCompMgr.registerFactoryLocation(CLASS_ID, CLASS_NAME, CONTRACT_ID,
                                     aFileSpec, aLocation, aType);
    aCompMgr.registerFactoryLocation(CLASS_ID2, CLASS_NAME, CONTRACT_ID2,
                                     aFileSpec, aLocation, aType);
    /*aCompMgr.RegisterComponent(CLASS_ID, CLASS_NAME, CONTRACT_ID,
                               aFileSpec, true, true);*/
  },

  unregisterSelf: function(aCompMgr, aLocation, aType) {
    aCompMgr = aCompMgr.QueryInterface(Ci.nsIComponentRegistrar);
    aCompMgr.unregisterFactoryLocation(CLASS_ID, aLocation);
    aCompMgr.unregisterFactoryLocation(CLASS_ID2, aLocation);
  },

  getClassObject: function(aCompMgr, aCID, aIID) {
    if (!aIID.equals(Ci.nsIFactory))
      throw Cr.NS_ERROR_NOT_IMPLEMENTED;

    if (aCID.equals(CLASS_ID))
      return SEOrganizerFactory;
    if(aCID.equals(CLASS_ID2))
      return FolderFactory;

    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  canUnload: function(aCompMgr) { return true; }
};

/***********************************************************
module initialization

When the application registers the component, this function
is called.
***********************************************************/
function NSGetModule(aCompMgr, aFileSpec) {
  return SEOrganizerModule;
}