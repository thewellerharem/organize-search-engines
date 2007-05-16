const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;
/***********************************************************
constants
***********************************************************/


// UUID uniquely identifying our component
// You can get from: http://kruithof.xs4all.nl/uuid/uuidgen here
const CLASS_ID = Components.ID("{1a6b3e72-eb74-11db-9041-00ffd1e32fc4}");
const CLASS_ID2 = Components.ID("{f2fa3794-eb73-11db-9d18-00ffd1e32fc4}");

// description
const CLASS_NAME = "For Organizing search engines in folders.";

const NS_RDF_DATASOURCE_PROGID_PREFIX = "@mozilla.org/rdf/datasource;1?name=";
// textual unique identifier
const CONTRACT_ID = NS_RDF_DATASOURCE_PROGID_PREFIX +
                    "organized-internet-search-engines";
const CONTRACT_ID2 = NS_RDF_DATASOURCE_PROGID_PREFIX +
                    "organized-internet-search-folders";

function LOG(msg) {
  msg = "Organize Search Engines:   " + msg;
  var consoleService = Cc["@mozilla.org/consoleservice;1"]
                         .getService(Ci.nsIConsoleService);
  consoleService.logStringMessage(msg);
  //dump(msg + "\n");
  return msg;
}

function Window () {};
Window.prototype = {
  setTimeout: function setTimeout(callback, timeout) {
    var timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    var obj = { notify: callback };
    timer.initWithCallback(obj, timeout, Ci.nsITimer.TYPE_ONE_SHOT);
    return timer;
  },
  setInterval: function setInterval(callback, timeout) {
    var timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    var obj = { notify: callback };
    timer.initWithCallback(obj, timeout, Ci.nsITimer.TYPE_REPEATING_PRECISE);
    return timer;
  },
  clearTimeout: function clearTimeout(timer) {
    timer.cancel();
  },
  openDialog: function openDialog() {
    var args = [];
    for(var i = 0; i < arguments.length; ++i)
      args.push(arguments[i]);
    var win = this._getMostRecentWindow();
    if(win) {
      try {
        return win.openDialog.apply(win, args);
      } catch(e) { }
    }
    throw Cr.NS_ERROR_NOT_AVAILABLE;
  },
  open: function open() {
    var args = [];
    for(var i = 0; i < arguments.length; ++i)
      args.push(arguments[i]);
    var win = this._getMostRecentWindow();
    if(win) {
      try {
        return win.open.apply(win, args);
      } catch(e) { }
    }
    throw Cr.NS_ERROR_NOT_AVAILABLE;
  },
  _getMostRecentWindow: function _getMostRecentWindow() {
    var mediator = Cc["@mozilla.org/appshell/window-mediator;1"]
                     .getService(Ci.nsIWindowMediator);
    return mediator.getMostRecentWindow("");
  },
  get document() {
    if(!this._document) {
      var origDoc = this._getMostRecentWindow().document;
      this._document = origDoc.implementation.createDocument("", "", null);
    }
    return this._document;
  },
  parent: null,
  faked: true
};
var window = new Window();
window.window = window.self = window.top = window;

function Reporter(e) {
  return window.Reporter(e);
}

(function() {
  var jsLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"]
                   .getService(Ci.mozIJSSubScriptLoader);
  jsLoader.loadSubScript("chrome://seorganizer/content/reporter.js", window);
})();


try {

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
  this.wrappedJSObject = this; // xxx
  this._init();
}

// class definition
SEOrganizer.prototype = {
  wrappedJSObject: null,
  indexOutOfDate: true,
  _init: function SEOrganizer___init() {
    this._datasource = this._rdfService.GetDataSourceBlocking(this._saveURI)
                           .QueryInterface(Ci.nsIRDFRemoteDataSource);

    var os = Cc["@mozilla.org/observer-service;1"]
               .getService(Ci.nsIObserverService);
    os.addObserver(this, "browser-search-engine-modified", false);

    var added = this._addMissingEnginesToRDF();
    var removed = this._removeNonExisting();
    if(added || removed)
      this.saveChanges();

    this._setUpWrappedJSObject();
    this._replaceAddEngineConfirmation();
  },

  saveChanges: function SEOrganizer__saveChanges() {
    this.Flush();

    // tell the normal search service the right order
    // but we do it with some delays so we don't block the UI thread for ages
    if(this.indexOutOfDate)
      this._updateIndexCache();
    var instance = this;
    var os = Cc["@mozilla.org/observer-service;1"]
               .getService(Ci.nsIObserverService);
    os.removeObserver(this, "browser-search-engine-modified");
    var engines = [];
    for(var i = 0; i < this._indexCache.length; ++i) {
      if(!this.isFolder(this._indexCache[i]) &&
         !this.isSeparator(this._indexCache[i])) {
        engines.push(this.getNameByItem(this._indexCache[i]));
      }
    }
    LOG(engines.join("\n"));
    i = 0;
    var ss = Cc["@mozilla.org/browser/search-service;1"]
               .getService(Ci.nsIBrowserSearchService);
    var obj = {
      notify: function notify() {
        if(i >= engines.length) {
          timer.cancel();
          os.addObserver(instance, "browser-search-engine-modified", false);
          os.removeObserver(quit, "quit-application");
          timer = null;
          return;
        }
        var engineName = engines[i];
        if(engineName) {
          var engine = ss.getEngineByName(engineName);
          if(engine instanceof Ci.nsISearchEngine) {
            try {
              instance.moveEngine(engine, i);
            } catch(e) {
              Components.reportError(e);
            }
          }
        }
        i = i + 1;
      }
    };
    var timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(obj, 3, Ci.nsITimer.TYPE_REPEATING_PRECISE);

    // it might happen that Firefox is exiting while we are still trying to tell
    // the search service of the right order. If so, let's freeze Firefox!
    var quit = {
      observe: function observe() {
        while(timer) {
          obj.notify();
        }
      }
    };
    os.addObserver(quit, "quit-application", false);
  },

  reload: function SEOrganizer__reload() {
    // circumvent a bug crashing firefox when a Seq has no children
    // xxx this is awfully slow!
    /*var modified = false;
    var file = this._saveFile;
    var inStream = Cc["@mozilla.org/network/file-input-stream;1"]
                     .createInstance(Ci.nsIFileInputStream);
    inStream.init(file, 0x01, 0666, Ci.nsIFileInputStream.CLOSE_ON_EOF);
    var parser = Cc["@mozilla.org/xmlextras/domparser;1"]
                   .createInstance(Ci.nsIDOMParser);
    var doc = parser.parseFromStream(inStream, "UTF-8", file.fileSize,
                                     "application/xml");
    inStream.close();
    doc.normalize();
    var elems = doc.getElementsByTagNameNS(NS_RDF, "Seq");
    for(var i = elems.length; i--;) {
      if(elems[i].firstChild == elems[i].lastChild &&
         elems[i].firstChild.nodeType == Ci.nsIDOMNode.TEXT_NODE) {
        var node = doc.createElementNS(NS_RDF, "li");
        node.setAttributeNS(NS_RDF, "resource", "rdf:null");
        elems[i].appendChild(node);
        modified = true;
      }
    }
    if(modified) {
      var serializer = Cc["@mozilla.org/xmlextras/xmlserializer;1"]
                         .createInstance(Ci.nsIDOMSerializer);
      var foStream = Cc["@mozilla.org/network/file-output-stream;1"]
                       .createInstance(Ci.nsIFileOutputStream);
      foStream.init(file, 0x02 | 0x08 | 0x20, 0664, 0);
      serializer.serializeToStream(doc, foStream, "");
      foStream.close();
    }*/
    // end circumvent crasher

    //this.Refresh(true); // crashes when there is an empty folder
    this.beginUpdateBatch();
    this._datasource = this._rdfService.GetDataSourceBlocking(this._saveURI)
                           .QueryInterface(Ci.nsIRDFRemoteDataSource);
    for(var i = 0; i < this._observers.length; ++i) {
      this._datasource.AddObserver(this._observers[i]);
    }
    this.endUpdateBatch();
    this.indexOutOfDate = true;
    this._addMissingEnginesToRDF();
    this._removeNonExisting();

    // notify observers
    var os = Cc["@mozilla.org/observer-service;1"].
             getService(Ci.nsIObserverService);
    os.notifyObservers(null, "browser-search-engine-modified",
                       "-engines-organized");
  },

  _engineFolders: {},
  // check if every installed (and visible) engine is in the rdf
  _addMissingEnginesToRDF: function addMissing() {
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
        if(engines[i].name in this._engineFolders) {
          var parent = this._engineFolders[engines[i].name];
          if(parent == FOLDERS_ROOT)
            parent = ROOT;
          try {
            parent = rdfService.GetResource(parent);
            delete this._engineFolders[engines[i].name];
            container = Cc["@mozilla.org/rdf/container;1"]
                          .createInstance(Ci.nsIRDFContainer);
            container.Init(this, parent);
          } catch(e) {
            container = rootContainer;
          }
        } else {
          container = rootContainer;
        }
        var current = this._getAnonymousResource();
        var currentName = rdfService.GetLiteral(engines[i].name);
        this.Assert(current, name, currentName, true);
        container.AppendElement(current);
        modified = true;
      }
    }
    return modified;
  },
  // remove engines from the rdf that do not exist (anymore)
  _removeNonExisting: function removeNonExisting() {
    var modified = false;
    for(var i = this.getChildCount(this.getRoot()); i--;) {
      try {
        var item = this.getItemByIndex(i);
        var engineName = this.getNameByItem(item);
        if(!this.isSeparator(item) && !this.isFolder(item)) {
          var engine = this.getEngineByName(engineName);
          if(!engine || engine.hidden) {
            this.removeItem(item);
            modified = true;
          }
        }
      } catch(e) { }
    }
    return modified;
  },

  _replaceAddEngineConfirmation: function() {
    var seOrganizer = this;

    var comparator = Cc["@mozilla.org/xpcom/version-comparator;1"]
                       .getService(Ci.nsIVersionComparator);
    var app  = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo)
                 .QueryInterface(Ci.nsIXULRuntime);
    var version = comparator.compare(app.version, "3.0a0pre");

    var topLevel = this._topLevel;
    const BUNDLE = topLevel.SIDEBAR_BUNDLE || topLevel.SEARCH_BUNDLE;
    var EnginePrototype = topLevel.Engine.prototype;
    EnginePrototype._confirmAddEngine = function confirmAddEngine() {
      var windowWatcher = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                            .getService(Ci.nsIWindowWatcher);
      var parent = windowWatcher.activeWindow;
      if(!parent)
        return;

      var sbs = Cc["@mozilla.org/intl/stringbundle;1"].
                getService(Ci.nsIStringBundleService);
      var stringBundle = sbs.createBundle(BUNDLE);

      var titleMessage = stringBundle.GetStringFromName("addEngineConfirmTitle");

      // Display only the hostname portion of the URL.
      if(version < 1) {
        var dialogMessage =
            stringBundle.formatStringFromName("addEngineConfirmText",
                                              [this._name, this._uri.host], 2);
      } else {
        dialogMessage =
          stringBundle.formatStringFromName("addEngineConfirmation",
                                            [this._name, this._uri.host], 2);
      }
      var checkboxMessage = stringBundle.GetStringFromName("addEngineUseNowText");
      var addButtonLabel =
          stringBundle.GetStringFromName("addEngineAddButtonLabel");

      var args =  Components.classes["@mozilla.org/embedcomp/dialogparam;1"].
                        createInstance(Components.interfaces.nsIDialogParamBlock);
      args.SetString(12, titleMessage);
      args.SetString(0, dialogMessage);
      args.SetString(1, checkboxMessage);
      args.SetInt(1, 0); // checkbox not checked by default
      args.SetString(3, ""); // header
      args.SetInt(2, 2); // number of buttons
      args.SetInt(5, 0); // default button
      args.SetString(8, addButtonLabel); // accept button label
      args.SetString(9, ""); // cancel button label
      args.SetInt(3, 0); // number of textboxes
      args.SetInt(6, 0); // no delay
      parent.openDialog("chrome://seorganizer/content/confirmAddEngine.xul",
                        "_blank", "centerscreen,chrome,modal,titlebar", args);
      var folder = args.GetString(13);
      seOrganizer._engineFolders[this.name] = folder;
      return {confirmed: !args.GetInt(0), useNow: args.GetInt(1)};
    };
  },

  _setUpWrappedJSObject: function() {
    var topLevel = this.defaultEngine.wrappedJSObject.__parent__;
    this._topLevel = topLevel;
    var ss = topLevel.SearchService.prototype;
    var orig = ss.getEngines;
    ss.getEngines = function(a) {
      this.wrappedJSObject = this; // NOW we have a .wrappedJSObject
      this.getEngines = orig; // restore the original function
      return orig.call(this, [].concat(arguments)); // call the original function
    };
    this._searchService.getEngines({});
    this._searchService = this._searchService.wrappedJSObject;
  },

  observe: function observe(aEngine, aTopic, aVerb) {
    if(aTopic === "browser-search-engine-modified") {
      switch(aVerb) {
        case "engine-removed":
          this._removeNonExisting();
          break;
        case "engine-added":
          this._addMissingEnginesToRDF();
          break;
        case "engine-current":
          // The current engine was changed.  Do nothing special.
          break;
        case "engine-changed":
          // An engine was hidden or unhidden or moved, or an icon was
          // changed.  We have to remove or add it from/to the RDF for the 
          // case it was hidden/unhidden (this doesn't call removed/added).
          if(aEngine.hidden)
            this._removeNonExisting();
          else
            this._addMissingEnginesToRDF();
      }
      // xxx we should notify the rdf observers of a changed icon
    }
  },

  isFolder: function SEOrganizer__isFolder(aResource) {
    const rdfService = this._rdfService;
    var property = rdfService.GetResource(NS_RDF + "instanceOf");
    var folder = rdfService.GetResource(NS_RDF + "Seq");
    return this.HasAssertion(aResource, property, folder, true);
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

    var type = rdfService.GetResource(NS_RDF + "type");
    var separator = rdfService.GetResource(NS + "separator");
    return this.HasAssertion(aResource, type, separator, true);
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

  removeItem: function SEOrganizer__removeItem(aItem) {
    var toRemove = [aItem];
    if(this.isFolder(aItem)) {
      const rdfService = this._rdfService;
      const rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                                  .getService(Ci.nsIRDFContainerUtils);
      var container = Cc["@mozilla.org/rdf/container;1"]
                        .createInstance(Ci.nsIRDFContainer);
      container.Init(this, aItem);
      var count = container.GetCount();
      for(var i = 0; ++i <= count;) {
        toRemove.push(this.GetTarget(aItem, rdfService.GetResource(NS_RDF + "_" + i), true));
      }
    }

    for(var i = 0; i < toRemove.length; ++i) {
      aItem = toRemove[i];
      // remove the underlying search engine file using nsIBrowserSearchService
      var name = this.getNameByItem(aItem);
      if(name) { // this may be a separator
        var engine = this.getEngineByName(name);
        if(engine && engine instanceof Ci.nsISearchEngine)
          this.removeEngine(engine);
      }

      /* remove everything from the rdf tree */
      // remove everything this item references to
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
    }
  },

  getRoot: function SEOrganizer__getRoot() {
    return this._rdfService.GetResource(ROOT);
  },
  itemWithNameExists: function SEOrganizer__itemExists(aName) {
    const rdfService = this._rdfService;

    var predicate = rdfService.GetResource(NS + "Name");
    var object = rdfService.GetLiteral(aName);

    if(this.hasArcIn(object, predicate)) {
      var ids = this.GetSources(predicate, object, true), id;
      while(ids.hasMoreElements()) {
        id = ids.getNext();
        if(this.ArcLabelsIn(id).hasMoreElements()) {
          return true;
        }
      }
    }
    return false;
  },
  getNameByItem: function SEOrganizer__getNameByItem(aItem) {
    const rdfService = this._rdfService;

    var predicate = rdfService.GetResource(NS + "Name");
    var name = this.GetTarget(aItem, predicate, true);
    if(name instanceof Ci.nsIRDFLiteral)
      return name.Value;
    return "";
  },
  getIconByIndex: function SEOrganizer__getIconByIndex(aIndex) {
    if(aIndex !== -1) {
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

    var predicate = rdfService.GetResource(NS + "Name");
    var object = rdfService.GetLiteral(aName);

    return this.GetSource(predicate, object, true);
  },

  getParent: function SEOrganizer__getParent(aItem) {
    var predicates = this.ArcLabelsIn(aItem);
    if(predicates.hasMoreElements()) {
      return this.GetSource(predicates.getNext(), aItem, true);
    }
    return Cr.NS_ERROR_INVALID_ARG;
  },

  _indexCache: [],
  getItemByIndex: function SEOrganizer__getItemByIndex(aIndex) {
    if(this.indexOutOfDate)
      this._updateIndexCache();
    if(this._indexCache.hasOwnProperty(aIndex))
      return this._indexCache[aIndex];
    throw Cr.NS_ERROR_ILLEGAL_VALUE;
  },
  _updateIndexCache: function _updateIndexCache() {
    if(this._updateBatchRunning)
      return;

    var cache = [];
    cache[-1] = this.getRoot();

    var count = -1;
    function callback(current) {
      cache[++count] = current;
      return false;
    }
    try {
      this._iterateAll(function(){}, callback);
    } catch(e) { }
    this.indexOutOfDate = false;
    return this._indexCache = cache;
  },
  indexOf: function SEOrganizer__indexOf(aItem, aGlobal) {
    if(this.indexOutOfDate)
      this._updateIndexCache();
    if(aGlobal) {
      return this._indexCache.indexOf(aItem);
    } else {
      var parent = this.getParent(aItem);
      var container = Cc["@mozilla.org/rdf/container;1"]
                        .createInstance(Ci.nsIRDFContainer);
      container.Init(this, parent);
      return container.IndexOf(aItem);
      //return this._indexCache.indexOf(aItem) - this._indexCache.indexOf(parent);
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
    return !(this.isSeparator(aNode));
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
    const searchService = this._searchService;
    const rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                                .getService(Ci.nsIRDFContainerUtils);

    if(!aFilter)
      aFilter = this._iterateAllDefaultCallback;

    var root = aRoot || rdfService.GetResource(ROOT);
    var rootContainer = rdfContainerUtils.MakeSeq(this, root);
    var name = rdfService.GetResource(NS + "Name");

    function Enumerator(nsISimpleEnumerator) {
      if(nsISimpleEnumerator instanceof Ci.nsISimpleEnumerator) {
        while(nsISimpleEnumerator.hasMoreElements()) {
          this.push(nsISimpleEnumerator.getNext());
        }
        this.reverse();
      } else if(nsISimpleEnumerator instanceof Array) {
        for(var i in nsISimpleEnumerator) {
          this.push(nsISimpleEnumerator[i]);
        }
      }
    }
    Enumerator.prototype = Array.prototype;

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
            case "_iterateAll::succeeded":
              return true;
            case "_iterateAll::abort":
              return false;
            default:
              throw e;
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
  _topLevel: null,

  /* make Firefox support search aliases */
  resolveKeyword: function(aName, aPostData) {
    var ss = this._searchService;
    var offset = aName.indexOf(" ");
    var alias = aName.substr(0, offset).toLowerCase();
    var engine = ss.getEngineByAlias(alias);
    var submission, keyword;
    if(engine != null) {
      keyword = (offset != -1) ? aName.substr(offset + 1) : "";
      submission = engine.getSubmission(keyword, null);
      aPostData.value = submission.postData;
      if(submission.uri) {
        return submission.uri.spec;
      }
    }
    return null;
  },

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
    return this._searchService.moveEngine(engine, newIndex);
  },
  removeEngine: function nsIBrowserSearchService__removeEngine(engine) {
    return this._searchService.removeEngine(engine);
  },
  get defaultEngine() {
    return this._searchService.defaultEngine;
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
    this._datasource.Refresh(blocking);
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
    return this._datasource.GetAllResource();
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
    } else if(property.ValueUTF8 === NS + "Selected"
        && !this.isSeparator(source) && truthValue) {
      try {
        if(this.isFolder(source)) {
          var name = this.currentEngine.name;
          var found = false;
          function find(item) {
            if(this.getNameByItem(item) == name) {
              found = true;
              throw new Error("_iterateAll::succeeded");
            }
          }
          this._iterateAll(find, null, source);
          return this._rdfService.GetLiteral(found.toString());
        } else if(this.getNameByItem(source) == this.currentEngine.name) {
          return this._rdfService.GetLiteral("true");
        } else {
          return this._rdfService.GetLiteral("false");
        }
      } catch(e) {
        return this._rdfService.GetLiteral("false");
      }
    } else if(property.Value == NS + "Name" && this.isSeparator(source)
              && truthValue) {
      try { // makes the built-in sorting mechanism work
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
          prevName.QueryInterface(Ci.nsIRDFLiteral);
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
    this._observers = obs.splice(obs.indexOf(observer), 1);
    return this._datasource.RemoveObserver(observer);
  },
  Unassert: function nsIRDFDataSource__Unassert(source, property, target) {
    var ret = this._datasource.Unassert(source, property, target);
    this.indexOutOfDate = true;
    return ret;
  },

  QueryInterface: function QueryInterface(aIID) {
    if(aIID.equals(Ci.nsISupports) || aIID.equals(Ci.nsIRDFDataSource) ||
       aIID.equals(Ci.nsISEOrganizer) || aIID.equals(Ci.nsIBrowserSearchService)) {
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
  var rdfService = Cc["@mozilla.org/rdf/rdf-service;1"]
                       .getService(Ci.nsIRDFService);
  var rdfContainerUtils = Cc["@mozilla.org/rdf/container-utils;1"]
                            .getService(Ci.nsIRDFContainerUtils);
  var seOrganizer = Cc[CONTRACT_ID].createInstance(Ci.nsISEOrganizer)
                      .wrappedJSObject;

  var root = rdfService.GetResource(FOLDERS_ROOT);
  var rootContainer = rdfContainerUtils.MakeSeq(datasource, root);

  try {
    var item = seOrganizer.getItemByIndex(0), i = 0;
    while(item) {
      if(seOrganizer.isFolder(item)) {
        rootContainer.AppendElement(item);
      }
      if(++i < seOrganizer._indexCache.length)
        item = seOrganizer.getItemByIndex(i);
      else
        break;
    }
  } catch(e) {}
}
FoldersOnly.prototype = {
  _datasource: null,

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
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    return this._datasource.Assert(source, property, target, truthValue);
  },
  beginUpdateBatch: function nsIRDFDataSource__beginUpdateBatch() {
    return this._datasource.beginUpdateBatch();
  },
  Change: function nsIRDFDataSouce__Change(source, property, oldTarget, newTarget) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
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
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    return this._datasource.Move(oldSource, newSource, property, target);
  },
  RemoveObserver: function nsIRDFDataSource__RemoveObserver(observer) {
    return this._datasource.RemoveObserver(observer);
  },
  Unassert: function nsIRDFDataSource__Unassert(source, property, target) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    return this._datasource.Unassert(source, property, target);
  },

  QueryInterface: function QueryInterface(aIID) {
    if(aIID.equals(Ci.nsISupports) || aIID.equals(Ci.nsIRDFDataSource))
      return this;
    throw Cr.NS_ERROR_NO_INTERFACE;
  }
};
} catch(e) {
  new Reporter(e);
  Components.reportError(e);
}

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
  _firstTime: true,
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